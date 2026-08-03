import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCRUDAudit } from "@/hooks/useCRUDAudit";
import {
  BulkDeleteLinkedRecordsDialog,
  type LinkAction,
  type LinkedRecordActionsByItem,
  type LinkTypeSpec,
  type BulkDeleteItemSummary,
  type BulkDeleteLinkedGroup,
} from "@/components/common/BulkDeleteLinkedRecordsDialog";
import { preloadAccountLinks, type AccountLinkCounts } from "@/lib/accountLinks";
import { isRpcMissingError } from "@/lib/isRpcMissingError";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountIds: string[];
  onDeleted: () => void;
}

interface LoadedData {
  items: BulkDeleteItemSummary[];
  linkTypes: LinkTypeSpec[];
  counts: Record<string, AccountLinkCounts>;
}

const LINK_TYPE_ORDER: Array<{
  key: keyof AccountLinkCounts;
  label: string;
  keepable: boolean;
  helper?: string;
}> = [
  { key: "contacts", label: "Contacts", keepable: true },
  { key: "deals", label: "Deals", keepable: true, helper: "Deleting a deal also removes its revenue schedule, stakeholders, documents, and action items." },
  { key: "leads", label: "Leads", keepable: true },
  { key: "campaigns", label: "Campaigns", keepable: false, helper: "The account link to each campaign is always removed. The campaigns themselves are not deleted." },
  { key: "campaignContacts", label: "Campaign contacts", keepable: true },
  { key: "actionItems", label: "Action items", keepable: false, helper: "Account-scoped action items are always deleted." },
];

// Chunk large id arrays before passing to supabase.in — keeps URL/payload
// under PostgREST limits when bulk-deleting selections that span many pages.
const chunk = <T,>(arr: T[], size = 200): T[][] => {
  if (!arr.length) return [];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export const BulkDeleteAccountsDialog = ({ open, onOpenChange, accountIds, onDeleted }: Props) => {
  const { toast } = useToast();
  const { logBulkDelete } = useCRUDAudit();
  const [data, setData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || accountIds.length === 0) { setData(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: rows } = await supabase
          .from("accounts")
          .select("id, account_name")
          .in("id", accountIds);
        const targets = (rows || []).map((r: any) => ({ id: r.id, account_name: r.account_name || "" }));
        const bundle = await preloadAccountLinks(targets);
        if (cancelled) return;

        const items: BulkDeleteItemSummary[] = targets.map((t) => {
          const c = bundle.counts[t.id];
          const parts: string[] = [];
          if (c?.contacts) parts.push(`${c.contacts} contacts`);
          if (c?.deals) parts.push(`${c.deals} deals`);
          if (c?.leads) parts.push(`${c.leads} leads`);
          if (c?.campaigns) parts.push(`${c.campaigns} campaigns`);
          if (c?.campaignContacts) parts.push(`${c.campaignContacts} campaign contacts`);
          if (c?.actionItems) parts.push(`${c.actionItems} action items`);

          const groups: BulkDeleteLinkedGroup[] = [];
          const contactRecs = bundle.contactsByAccount[t.id] || [];
          if (contactRecs.length) groups.push({
            key: "contacts", label: "Contacts",
            records: contactRecs.map((r) => ({ id: r.id, name: r.contact_name || "(unnamed)", meta: r.email || r.position || undefined })),
          });
          const dealRecs = bundle.dealsByAccount[t.id] || [];
          if (dealRecs.length) groups.push({
            key: "deals", label: "Deals",
            records: dealRecs.map((r: any) => ({ id: r.id, name: r.project_name || r.customer_name || r.lead_name || "(untitled deal)", meta: r.stage || undefined })),
          });
          const leadRecs = bundle.leadsByAccount[t.id] || [];
          if (leadRecs.length) groups.push({
            key: "leads", label: "Leads",
            records: leadRecs.map((r) => ({ id: r.id, name: r.lead_name || r.email || "(unnamed lead)", meta: r.lead_status || undefined })),
          });
          const campRecs = bundle.campaignsByAccount[t.id] || [];
          if (campRecs.length) groups.push({
            key: "campaigns", label: "Campaigns",
            records: campRecs.map((r) => ({ id: r.id, name: r.campaign_name || "(untitled campaign)", meta: r.status || r.campaign_type || undefined })),
          });
          const ccRecs = bundle.campaignContactsByAccount[t.id] || [];
          if (ccRecs.length) groups.push({
            key: "campaignContacts", label: "Campaign contacts",
            records: ccRecs.map((r) => ({ id: r.id, name: r.contact_name || "(contact)", meta: r.stage || undefined })),
          });
          const aiRecs = bundle.actionsByAccount[t.id] || [];
          if (aiRecs.length) groups.push({
            key: "actionItems", label: "Action items",
            records: aiRecs.map((r) => ({ id: r.id, name: r.title || "(untitled action)", meta: r.due_date || r.status || undefined })),
          });

          return {
            id: t.id,
            name: t.account_name,
            subtitle: parts.length ? parts.join(" · ") : "No linked records",
            linkGroups: groups,
          };
        });

        const totals = LINK_TYPE_ORDER.reduce<Record<string, number>>((acc, t) => {
          acc[t.key] = accountIds.reduce((s, id) => s + (bundle.counts[id]?.[t.key] || 0), 0);
          return acc;
        }, {});

        const linkTypes: LinkTypeSpec[] = LINK_TYPE_ORDER.map((t) => ({
          key: t.key as string,
          label: t.label,
          count: totals[t.key] || 0,
          keepable: t.keepable,
          helper: t.helper,
        }));

        setData({ items, linkTypes, counts: bundle.counts });
      } catch (err: any) {
        console.error("preloadAccountLinks failed", err);
        toast({ title: "Failed to load linked records", description: err?.message || "", variant: "destructive" });
        setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, accountIds, toast]);

  const perform = async (actions: LinkedRecordActionsByItem) => {
    if (!data) return;
    setSubmitting(true);
    try {
      const ids = accountIds;

      const collectRecordIdsByAction = (groupKey: string, defaultAction: LinkAction = "keep") => {
        const keepIds = new Set<string>();
        const deleteIds = new Set<string>();

        for (const item of data.items) {
          const group = item.linkGroups?.find((g) => g.key === groupKey);
          if (!group?.records.length) continue;
          const action = actions[item.id]?.[groupKey] ?? defaultAction;
          const target = action === "delete" ? deleteIds : keepIds;
          for (const record of group.records) target.add(record.id);
        }

        for (const deletedId of deleteIds) keepIds.delete(deletedId);
        return { keepIds: [...keepIds], deleteIds: [...deleteIds] };
      };

      const contactActions = collectRecordIdsByAction("contacts");
      const leadActions = collectRecordIdsByAction("leads");
      const campaignContactActions = collectRecordIdsByAction("campaignContacts");
      const dealActions = collectRecordIdsByAction("deals");

      // Atomic path: single-transaction RPC on the server. If a partial failure
      // happens mid-cascade Postgres rolls the whole thing back, so contacts
      // can no longer be silently detached from an account that ultimately
      // failed to delete. Falls back to the legacy per-step client cascade only
      // if the RPC isn't deployed yet.
      const rpcArgs = {
        p_account_ids: ids,
        p_contact_delete_ids: contactActions.deleteIds,
        p_contact_detach_ids: contactActions.keepIds,
        p_lead_delete_ids: leadActions.deleteIds,
        p_lead_detach_ids: leadActions.keepIds,
        p_campaign_contact_delete_ids: campaignContactActions.deleteIds,
        p_campaign_contact_detach_ids: campaignContactActions.keepIds,
        p_deal_delete_ids: dealActions.deleteIds,
        p_deal_detach_ids: dealActions.keepIds,
      };
      const { data: rpcRes, error: rpcErr } = await (supabase as any).rpc(
        "delete_accounts_cascade",
        rpcArgs,
      );

      let summary: Record<string, number> = {};
      if (rpcErr && !isRpcMissingError(rpcErr)) {
        throw rpcErr;
      }
      if (!rpcErr && rpcRes) {
        summary = rpcRes as Record<string, number>;
      } else {
        // Legacy fallback — still non-atomic, but only used when the RPC is missing.
        // Chunked so very large selections don't blow the PostgREST URL limit.
        const runChunkedDelete = async (table: string, list: string[]) => {
          let count = 0;
          for (const c of chunk(list)) {
            const { error } = await supabase.from(table as any).delete().in("id", c);
            if (error) throw error;
            count += c.length;
          }
          return count;
        };
        const runChunkedDetach = async (table: string, list: string[]) => {
          let count = 0;
          for (const c of chunk(list)) {
            const { error } = await supabase.from(table as any).update({ account_id: null }).in("id", c);
            if (error) throw error;
            count += c.length;
          }
          return count;
        };

        summary.contacts_deleted = await runChunkedDelete("contacts", contactActions.deleteIds);
        summary.contacts_detached = await runChunkedDetach("contacts", contactActions.keepIds);
        summary.leads_deleted = await runChunkedDelete("leads", leadActions.deleteIds);
        summary.leads_detached = await runChunkedDetach("leads", leadActions.keepIds);
        summary.campaign_contacts_deleted = await runChunkedDelete("campaign_contacts", campaignContactActions.deleteIds);
        summary.campaign_contacts_detached = await runChunkedDetach("campaign_contacts", campaignContactActions.keepIds);
        summary.deals_deleted = await runChunkedDelete("deals", dealActions.deleteIds);
        summary.deals_detached = await runChunkedDetach("deals", dealActions.keepIds);
        {
          let camp = 0;
          for (const c of chunk(ids)) {
            const { error } = await supabase.from("campaign_accounts").delete().in("account_id", c);
            if (error) throw error;
            camp += c.length;
          }
          summary.campaign_account_links_deleted = camp;
        }
        {
          let ai = 0;
          for (const c of chunk(ids)) {
            const { error } = await supabase
              .from("action_items")
              .delete()
              .eq("module_type", "accounts")
              .in("module_id", c);
            if (error) throw error;
            ai += c.length;
          }
          summary.action_items_deleted = ai;
        }
        {
          let accts = 0;
          for (const c of chunk(ids)) {
            const { error } = await supabase.from("accounts").delete().in("id", c);
            if (error) throw error;
            accts += c.length;
          }
          summary.accounts_deleted = accts;
        }
      }

      // Per-resource audit trail — the previous version only logged the account
      // count, undercounting the side-effect deletions the user just authorized.
      const audit = async (module: string, count: number, sampleIds?: string[]) => {
        if (!count) return;
        try {
          await logBulkDelete(module as any, count, (sampleIds || []).slice(0, 100));
        } catch (e) {
          console.warn("audit log failed for", module, e);
        }
      };
      await audit("accounts", summary.accounts_deleted ?? ids.length, ids);
      await audit("contacts", summary.contacts_deleted ?? 0, contactActions.deleteIds);
      await audit("leads", summary.leads_deleted ?? 0, leadActions.deleteIds);
      await audit("campaign_contacts", summary.campaign_contacts_deleted ?? 0, campaignContactActions.deleteIds);
      await audit("deals", summary.deals_deleted ?? 0, dealActions.deleteIds);
      await audit("action_items", summary.action_items_deleted ?? 0);
      await audit("campaign_accounts", summary.campaign_account_links_deleted ?? 0);

      toast({
        title: "Deleted",
        description: `${summary.accounts_deleted ?? ids.length} account${(summary.accounts_deleted ?? ids.length) !== 1 ? "s" : ""} deleted.`,
      });
      onDeleted();
      onOpenChange(false);
    } catch (err: any) {
      console.error("Bulk delete accounts failed", err);
      toast({ title: "Delete failed", description: err?.message || "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BulkDeleteLinkedRecordsDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${accountIds.length} Account${accountIds.length !== 1 ? "s" : ""}?`}
      itemLabel="account"
      items={data?.items || []}
      linkTypes={data?.linkTypes || []}
      loading={loading}
      submitting={submitting}
      onConfirm={perform}
    />
  );
};

export default BulkDeleteAccountsDialog;
