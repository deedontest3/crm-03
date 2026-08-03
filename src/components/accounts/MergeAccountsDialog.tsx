import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GitMerge, ArrowRight, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCRUDAudit } from "@/hooks/useCRUDAudit";
import type { CleanupAccount } from "@/lib/accountCleanup";
import { repointAccountLinks, type AccountLinkCounts } from "@/lib/accountLinks";
import { isRpcMissingError } from "@/lib/isRpcMissingError";
import { AppLoader } from "@/components/ui/loader";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accounts: CleanupAccount[];
  linkCounts: Record<string, AccountLinkCounts>;
  onMerged: () => void;
}

const MERGE_FIELDS: (keyof CleanupAccount)[] = [
  "account_name", "industry", "country", "phone", "website", "description",
  "account_owner", "company_type", "region",
];

export const MergeAccountsDialog = ({ open, onOpenChange, accounts, linkCounts, onMerged }: Props) => {
  const { toast } = useToast();
  const { logBulkDelete } = useCRUDAudit();
  const totalLinks = (id: string) => {
    const c = linkCounts[id];
    return c
      ? c.contacts + c.deals + c.campaigns + c.actionItems + (c.leads || 0) + (c.campaignContacts || 0)
      : 0;
  };
  const defaultSurvivor = useMemo(() => {
    // Pick the record with the MOST total links so the smaller record's links
    // get repointed onto the bigger one. Tiebreak by field-fill count.
    return [...accounts].sort((a, b) => {
      const la = totalLinks(a.id);
      const lb = totalLinks(b.id);
      if (la !== lb) return lb - la;
      const fa = MERGE_FIELDS.filter((f) => a[f]).length;
      const fb = MERGE_FIELDS.filter((f) => b[f]).length;
      return fb - fa;
    })[0]?.id ?? "";
  }, [accounts, linkCounts]);

  const [survivorId, setSurvivorId] = useState<string>(defaultSurvivor);
  const [step, setStep] = useState<1 | 2>(1);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (open) {
      setSurvivorId(defaultSurvivor);
      setStep(1);
    }
  }, [open, defaultSurvivor]);

  const survivor = accounts.find((a) => a.id === survivorId);
  const losers = accounts.filter((a) => a.id !== survivorId);

  // Build merged preview: for each field, take survivor's value, or fall back to first loser with a value.
  const merged: Partial<CleanupAccount> = useMemo(() => {
    if (!survivor) return {};
    const out: any = { ...survivor };
    for (const f of MERGE_FIELDS) {
      if (out[f]) continue;
      for (const l of losers) {
        if (l[f]) { out[f] = l[f]; break; }
      }
    }
    return out;
  }, [survivor, losers]);

  const doMerge = async () => {
    if (!survivor) return;
    setRunning(true);
    try {
      const patch: Record<string, any> = {};
      for (const f of MERGE_FIELDS) if (merged[f]) patch[f] = merged[f];
      const loserIds = losers.map((l) => l.id);
      const survivorName = survivor.account_name || "";

      // Preferred path: atomic server-side merge via SECURITY DEFINER RPC.
      // Falls back to the legacy per-step client path if the RPC is not
      // installed on this Supabase project yet (see supabase/manual/merge_accounts_rpc.sql).
      let totals = {
        contacts: 0, deals: 0, campaigns: 0, actionItems: 0, campaignsDropped: 0,
      };
      let usedRpc = false;
      const { data: rpcData, error: rpcErr } = await (supabase as any).rpc("merge_accounts", {
        p_survivor_id: survivor.id,
        p_loser_ids: loserIds,
        p_patch: patch,
      });
      const rpcMissing = !!rpcErr && isRpcMissingError(rpcErr);
      if (rpcErr && !rpcMissing) throw rpcErr;
      if (!rpcErr && rpcData) {
        usedRpc = true;
        totals.contacts = Number(rpcData.contacts) || 0;
        totals.deals = Number(rpcData.deals) || 0;
        totals.campaigns = Number(rpcData.campaigns_repointed) || 0;
        totals.campaignsDropped = Number(rpcData.campaigns_dropped) || 0;
        totals.actionItems = Number(rpcData.action_items) || 0;
      } else {
        // Legacy fallback: non-atomic per-step
        if (Object.keys(patch).length) {
          const { error: upErr } = await supabase.from("accounts").update(patch).eq("id", survivor.id);
          if (upErr) throw upErr;
        }
        for (const l of losers) {
          const res = await repointAccountLinks({
            loserId: l.id,
            loserName: l.account_name || "",
            survivorId: survivor.id,
            survivorName,
          });
          totals.contacts += res.contacts;
          totals.deals += res.deals;
          totals.campaigns += res.campaigns;
          totals.actionItems += res.actionItems;
          totals.campaignsDropped += res.campaignsDropped;
        }
        const { error: delErr } = await supabase.from("accounts").delete().in("id", loserIds);
        if (delErr) throw delErr;
      }
      await logBulkDelete("accounts", loserIds.length, loserIds);

      toast({
        title: usedRpc ? "Merged (atomic)" : "Merged",
        description: `Kept "${survivorName}", removed ${loserIds.length} duplicate${loserIds.length !== 1 ? "s" : ""}. Repointed ${totals.contacts} contact(s), ${totals.deals} deal(s), ${totals.campaigns} campaign link(s)${totals.campaignsDropped ? ` (${totals.campaignsDropped} deduped)` : ""}, ${totals.actionItems} action item(s).`,
      });
      onMerged();
    } catch (e: any) {
      console.error("[merge]", e);
      toast({ title: "Merge failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5" /> Merge {accounts.length} accounts — Step {step} of 2
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Pick which record to keep (survivor). We suggest the one with the most links so smaller records get repointed onto it."
              : "Review the exact link transfer below. Nothing is written until you confirm."}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-3">
        {step === 1 ? (
          <RadioGroup value={survivorId} onValueChange={setSurvivorId} className="space-y-2">
            {accounts.map((a) => {
              const links = totalLinks(a.id);
              const c = linkCounts[a.id];
              return (
                <label
                  key={a.id}
                  htmlFor={`s-${a.id}`}
                  className={`flex items-start gap-3 border rounded-md p-3 cursor-pointer ${survivorId === a.id ? "border-primary bg-primary/5" : ""}`}
                >
                  <RadioGroupItem id={`s-${a.id}`} value={a.id} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{a.account_name || <em className="text-muted-foreground">(empty)</em>}</span>
                      <span className="text-xs text-muted-foreground">{links} link{links !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 grid grid-cols-4 gap-x-2">
                      <span>Contacts: {c?.contacts ?? 0}</span>
                      <span>Deals: {c?.deals ?? 0}</span>
                      <span>Campaigns: {c?.campaigns ?? 0}</span>
                      <span>Actions: {c?.actionItems ?? 0}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 grid grid-cols-2 gap-x-4">
                      <span>Industry: {a.industry || "—"}</span>
                      <span>Country: {a.country || "—"}</span>
                      <span>Phone: {a.phone || "—"}</span>
                      <span className="truncate">Website: {a.website || "—"}</span>
                    </div>
                  </div>
                </label>
              );
            })}
          </RadioGroup>
        ) : (
          <div className="space-y-4">
            {survivor && (
              <div className="border rounded-md p-3 bg-primary/5 border-primary">
                <div className="text-xs font-medium text-primary uppercase mb-1">Survivor (kept)</div>
                <div className="font-medium">{survivor.account_name || "(empty)"}</div>
                <div className="text-xs text-muted-foreground mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                  {MERGE_FIELDS.map((f) => {
                    // Highlight fields where a loser had a different non-empty
                    // value that would be lost by keeping the survivor's.
                    const survivorVal = (survivor as any)[f] as string | undefined;
                    const losingVals = losers
                      .map((l) => (l as any)[f] as string | undefined)
                      .filter((v) => v && v !== survivorVal);
                    const chosen = (merged as any)[f] as string | undefined;
                    const conflict = !!survivorVal && losingVals.length > 0;
                    return (
                      <Label
                        key={f}
                        className={`flex justify-between gap-2 rounded px-1 ${conflict ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}
                        title={conflict ? `Losers had: ${losingVals.join(" · ")}` : undefined}
                      >
                        <span className="text-muted-foreground">
                          {String(f)}{conflict ? " ⚠" : ""}:
                        </span>
                        <span className="truncate">{chosen || "—"}</span>
                      </Label>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase text-muted-foreground">Link transfer</div>
              {losers.map((l) => {
                const c = linkCounts[l.id];
                const rows = [
                  ["Contacts", c?.contacts ?? 0],
                  ["Deals", c?.deals ?? 0],
                  ["Leads", c?.leads ?? 0],
                  ["Campaigns", c?.campaigns ?? 0],
                  ["Campaign contacts", c?.campaignContacts ?? 0],
                  ["Action items", c?.actionItems ?? 0],
                ] as const;
                const total = rows.reduce((s, [, n]) => s + n, 0);
                return (
                  <div key={l.id} className="border rounded-md p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-destructive line-through">{l.account_name || "(empty)"}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className="font-medium">{survivor?.account_name || "(empty)"}</span>
                    </div>
                    {total === 0 ? (
                      <div className="text-xs text-muted-foreground mt-1">No links to transfer — record will be deleted directly.</div>
                    ) : (
                      <div className="text-xs mt-2 grid grid-cols-3 gap-2">
                        {rows.map(([label, n]) => (
                          <div key={label} className={`rounded px-2 py-1 ${n > 0 ? "bg-muted" : "text-muted-foreground"}`}>
                            {label}: <span className="font-medium">{n}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300 border border-amber-200 dark:border-amber-900 rounded p-3">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>All links above will be repointed to the survivor before the {losers.length} loser record{losers.length !== 1 ? "s are" : " is"} deleted. This cannot be undone.</span>
            </div>
          </div>
        )}
        </ScrollArea>

        <DialogFooter className="border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>Cancel</Button>
          {step === 1 ? (
            <Button onClick={() => setStep(2)} disabled={!survivor || losers.length === 0} className="gap-1">
              Next: review transfer <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(1)} disabled={running}>Back</Button>
              <Button onClick={doMerge} disabled={running || !survivor} className="gap-1">
                {running ? <AppLoader variant="inline" /> : <GitMerge className="h-4 w-4" />}
                Confirm merge & delete {losers.length}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MergeAccountsDialog;