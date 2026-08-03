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
import { preloadContactLinks } from "@/lib/contactLinks";
import { getContactLinkedDeals } from "@/lib/contactLinkedDeals";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contactIds: string[];
  onDeleted: () => void;
}

interface LoadedData {
  items: BulkDeleteItemSummary[];
  linkTypes: LinkTypeSpec[];
}

export const BulkDeleteContactsDialog = ({ open, onOpenChange, contactIds, onDeleted }: Props) => {
  const { toast } = useToast();
  const { logBulkDelete } = useCRUDAudit();
  const [data, setData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    // If the caller opened the dialog with no ids (e.g. selection cleared
    // between click and render), close immediately instead of showing an
    // empty confirm shell.
    if (contactIds.length === 0) { onOpenChange(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: rows } = await supabase
          .from("contacts")
          .select("id, contact_name, company_name, account_id")
          .in("id", contactIds);
        const targets = (rows || []).map((r: any) => ({
          id: r.id, contact_name: r.contact_name, company_name: r.company_name, account_id: r.account_id,
        }));
        const [{ counts }, dealsByContact, stakeCountsRes, campContactsRes, commsRes, variantsRes, actionItemsRes] = await Promise.all([
          preloadContactLinks(targets),
          getContactLinkedDeals(targets),
          supabase.from("deal_stakeholders").select("id, contact_id, role, deal_id").in("contact_id", contactIds),
          supabase.from("campaign_contacts").select("id, contact_id, stage, campaign_id").in("contact_id", contactIds),
          supabase.from("campaign_communications").select("id, contact_id, communication_type, subject, email_status, communication_date").in("contact_id", contactIds),
          supabase.from("campaign_variant_assignments").select("id, contact_id, campaign_id, variant_id").in("contact_id", contactIds),
          supabase.from("action_items").select("id, title, status, due_date, module_id").eq("module_type", "contacts").in("module_id", contactIds),
        ]);
        if (cancelled) return;

        const stakeholderCount = (stakeCountsRes.data || []).length;

        const bucket = <T extends { contact_id?: string | null; module_id?: string | null }>(rows: T[] | null, key: 'contact_id' | 'module_id' = 'contact_id') => {
          const out: Record<string, T[]> = {};
          for (const r of (rows || [])) {
            const k = (r as any)[key];
            if (!k) continue;
            (out[k] ||= []).push(r);
          }
          return out;
        };

        const stakeholdersByContact = bucket(stakeCountsRes.data as any[]);
        const campaignContactsByContact = bucket(campContactsRes.data as any[]);
        const communicationsByContact = bucket(commsRes.data as any[]);
        const variantsByContact = bucket(variantsRes.data as any[]);
        const actionItemsByContact = bucket(actionItemsRes.data as any[], 'module_id');
        const actionItemsCount = (actionItemsRes.data || []).length;

        const accountIds = Array.from(new Set(targets.map((t) => t.account_id).filter(Boolean))) as string[];
        const accountNameById = new Map<string, { name: string; region: string | null }>();
        if (accountIds.length) {
          const { data: accRows } = await supabase.from("accounts").select("id, account_name, region").in("id", accountIds);
          for (const a of (accRows || []) as any[]) {
            accountNameById.set(a.id, { name: a.account_name || "(unnamed account)", region: a.region ?? null });
          }
        }
        if (cancelled) return;

        const campaignIds = Array.from(new Set(
          (campContactsRes.data || []).map((r: any) => r.campaign_id).filter(Boolean),
        )) as string[];
        const campaignById = new Map<string, { name: string; status: string | null }>();
        if (campaignIds.length) {
          const { data: campRows } = await supabase.from("campaigns").select("id, campaign_name, status").in("id", campaignIds);
          for (const c of (campRows || []) as any[]) {
            campaignById.set(c.id, { name: c.campaign_name || "(untitled campaign)", status: c.status ?? null });
          }
        }
        if (cancelled) return;

        const items: BulkDeleteItemSummary[] = targets.map((t) => {
          const c = counts[t.id];
          const dealsN = (dealsByContact[t.id] || []).length;
          const commsN = (communicationsByContact[t.id] || []).length;
          const aiN = (actionItemsByContact[t.id] || []).length;
          const parts: string[] = [];
          if (t.account_id && accountNameById.has(t.account_id)) parts.push("1 account");
          if (dealsN) parts.push(`${dealsN} deals`);
          if (c?.campaignContacts) parts.push(`${c.campaignContacts} campaigns`);
          if (commsN) parts.push(`${commsN} communications`);
          if (aiN) parts.push(`${aiN} action items`);

          const groups: BulkDeleteLinkedGroup[] = [];
          if (t.account_id && accountNameById.has(t.account_id)) {
            const acc = accountNameById.get(t.account_id)!;
            groups.push({
              key: "account", label: "Account",
              records: [{ id: t.account_id, name: acc.name, meta: acc.region || undefined }],
            });
          }
          const dealRecs = dealsByContact[t.id] || [];
          if (dealRecs.length) groups.push({
            key: "deals", label: "Deals",
            records: dealRecs.map((r: any) => ({ id: r.id, name: r.project_name || r.customer_name || r.lead_name || "(untitled deal)", meta: r.stage || undefined })),
          });
          const stakeholderRecs = stakeholdersByContact[t.id] || [];
          if (stakeholderRecs.length) groups.push({
            key: "stakeholders", label: "Deal stakeholders",
            records: stakeholderRecs.map((r: any) => ({ id: r.id, name: r.role || "Deal stakeholder", meta: r.deal_id || undefined })),
          });
          const campaignContactRecs = campaignContactsByContact[t.id] || [];
          if (campaignContactRecs.length) groups.push({
            key: "campaignContacts", label: "Campaigns",
            records: campaignContactRecs.map((r: any) => {
              const camp = r.campaign_id ? campaignById.get(r.campaign_id) : undefined;
              return { id: r.id, name: camp?.name || "Campaign membership", meta: r.stage || camp?.status || undefined };
            }),
          });
          const commRecs = communicationsByContact[t.id] || [];
          if (commRecs.length) groups.push({
            key: "communications", label: "Campaign communications",
            records: commRecs.map((r: any) => ({ id: r.id, name: r.subject || r.communication_type || "Communication", meta: r.email_status || r.communication_date || undefined })),
          });
          const variantRecs = variantsByContact[t.id] || [];
          if (variantRecs.length) groups.push({
            key: "variants", label: "A/B variant assignments",
            records: variantRecs.map((r: any) => ({ id: r.id, name: "Variant assignment", meta: r.variant_id || r.campaign_id || undefined })),
          });
          const aiRecs = actionItemsByContact[t.id] || [];
          if (aiRecs.length) groups.push({
            key: "actionItems", label: "Action items",
            records: aiRecs.map((r: any) => ({ id: r.id, name: r.title || "(untitled action)", meta: r.due_date || r.status || undefined })),
          });

          return {
            id: t.id,
            name: t.contact_name || t.company_name || "(unnamed)",
            subtitle: parts.length ? parts.join(" · ") : "No linked records",
            linkGroups: groups,
          };
        });

        const totalAccounts = targets.filter((t) => t.account_id && accountNameById.has(t.account_id)).length;
        const totalDeals = targets.reduce((s, t) => s + (dealsByContact[t.id] || []).length, 0);
        const totalCampaignContacts = targets.reduce((s, t) => s + (counts[t.id]?.campaignContacts || 0), 0);
        const totalComms = targets.reduce((s, t) => s + (counts[t.id]?.campaignCommunications || 0), 0);
        const totalVariants = targets.reduce((s, t) => s + (counts[t.id]?.variantAssignments || 0), 0);

        const linkTypes: LinkTypeSpec[] = [
          { key: "account", label: "Account", count: totalAccounts, informational: true },
          { key: "deals", label: "Deals", count: totalDeals, keepable: true },
          { key: "stakeholders", label: "Deal stakeholders", count: stakeholderCount, keepable: false },
          { key: "campaignContacts", label: "Campaigns", count: totalCampaignContacts, keepable: false },
          { key: "communications", label: "Campaign communications", count: totalComms, keepable: true },
          { key: "variants", label: "A/B variant assignments", count: totalVariants, keepable: false },
          { key: "actionItems", label: "Action items", count: actionItemsCount, keepable: false },
        ];

        setData({ items, linkTypes });
      } catch (err: any) {
        console.error("preloadContactLinks failed", err);
        toast({ title: "Failed to load linked records", description: err?.message || "", variant: "destructive" });
        setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, contactIds, toast]);

  const perform = async (actions: LinkedRecordActionsByItem) => {
    if (!data) return;
    setSubmitting(true);
    try {
      const ids = contactIds;

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

      const dealActions = collectRecordIdsByAction("deals");
      const communicationActions = collectRecordIdsByAction("communications");

      // Single-transaction cascade via RPC — atomic, no half-detached rows on failure.
      const { data: summary, error } = await supabase.rpc('delete_contacts_cascade', {
        _contact_ids: ids,
        _delete_deal_ids: dealActions.deleteIds,
        _detach_deal_ids: dealActions.keepIds,
        _delete_comm_ids: communicationActions.deleteIds,
        _detach_comm_ids: communicationActions.keepIds,
      });
      if (error) throw error;

      await logBulkDelete("contacts", ids.length, ids);
      const s = (summary || {}) as Record<string, number>;
      const deleted = s.contacts ?? ids.length;
      if (deleted !== ids.length) {
        console.warn(`[bulk-delete-contacts] requested ${ids.length} deletes but RPC reported ${deleted}. Some rows may have been protected by RLS.`);
      }
      const parts = [
        `${deleted} contact${deleted !== 1 ? 's' : ''} deleted`,
        deleted !== ids.length ? `(${ids.length - deleted} skipped)` : null,
        s.deals_deleted ? `${s.deals_deleted} deals deleted` : null,
        s.deals_detached ? `${s.deals_detached} deals detached` : null,
        s.stakeholders ? `${s.stakeholders} stakeholder links` : null,
        s.campaign_contacts ? `${s.campaign_contacts} campaign memberships` : null,
        s.action_items ? `${s.action_items} action items` : null,
      ].filter(Boolean);
      toast({ title: "Deleted", description: parts.join(' · ') });
      onDeleted();
      onOpenChange(false);
    } catch (err: any) {
      console.error("Bulk delete contacts failed", err);
      toast({ title: "Delete failed", description: err?.message || "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BulkDeleteLinkedRecordsDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${contactIds.length} Contact${contactIds.length !== 1 ? "s" : ""}?`}
      itemLabel="contact"
      items={data?.items || []}
      linkTypes={data?.linkTypes || []}
      loading={loading}
      submitting={submitting}
      onConfirm={perform}
    />
  );
};

export default BulkDeleteContactsDialog;
