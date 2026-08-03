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
import type { CleanupContact } from "@/lib/contactCleanup";
import type { ContactLinkCounts } from "@/lib/contactLinks";
import { AppLoader } from "@/components/ui/loader";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contacts: CleanupContact[];
  linkCounts: Record<string, ContactLinkCounts>;
  onMerged: () => void;
}

// Editable/writable fields — one column per contact so the user can cherry-pick
// which value survives. Read-only IDs/timestamps stay out of this list.
const MERGE_FIELDS: (keyof CleanupContact)[] = [
  "contact_name", "company_name", "email", "phone_no",
  "position", "contact_owner", "account_id",
];

const totalOf = (c?: ContactLinkCounts) => c
  ? c.deals + c.campaignContacts + c.campaignCommunications + c.variantAssignments
  : 0;

export const MergeContactsDialog = ({ open, onOpenChange, contacts, linkCounts, onMerged }: Props) => {
  const { toast } = useToast();
  const { logBulkDelete } = useCRUDAudit();

  // Suggest survivor: most links, tiebreak by fill-count.
  const suggested = useMemo(() => {
    return [...contacts].sort((a, b) => {
      const la = totalOf(linkCounts[a.id]);
      const lb = totalOf(linkCounts[b.id]);
      if (la !== lb) return lb - la;
      const fa = MERGE_FIELDS.filter((f) => (a as any)[f]).length;
      const fb = MERGE_FIELDS.filter((f) => (b as any)[f]).length;
      return fb - fa;
    })[0]?.id ?? "";
  }, [contacts, linkCounts]);

  const [survivorId, setSurvivorId] = useState<string>(suggested);
  const [step, setStep] = useState<1 | 2>(1);
  const [running, setRunning] = useState(false);
  // Per-field source picker (contact id whose value survives).
  const [fieldSource, setFieldSource] = useState<Record<string, string>>({});

  const survivor = contacts.find((a) => a.id === survivorId);
  const losers = contacts.filter((a) => a.id !== survivorId);

  useEffect(() => {
    if (!open) return;
    setSurvivorId(suggested);
    setStep(1);
  }, [open, suggested]);

  // Re-default field-source picker whenever the survivor changes (or on open).
  // Prefer the survivor's non-empty value; fall back to first non-empty across losers.
  useEffect(() => {
    if (!open || !survivorId) return;
    const order = [survivorId, ...contacts.filter((c) => c.id !== survivorId).map((c) => c.id)];
    const src: Record<string, string> = {};
    for (const f of MERGE_FIELDS) {
      for (const id of order) {
        const rec = contacts.find((c) => c.id === id);
        if (rec && (rec as any)[f]) { src[f as string] = id; break; }
      }
      if (!src[f as string]) src[f as string] = survivorId;
    }
    setFieldSource(src);
  }, [open, survivorId, contacts]);

  const merged: Partial<CleanupContact> = useMemo(() => {
    if (!survivor) return {};
    const out: any = { ...survivor };
    for (const f of MERGE_FIELDS) {
      const sourceId = fieldSource[f as string];
      const rec = contacts.find((c) => c.id === sourceId);
      out[f] = rec ? (rec as any)[f] ?? null : (survivor as any)[f];
    }
    return out;
  }, [survivor, fieldSource, contacts]);

  const doMerge = async () => {
    if (!survivor) return;
    setRunning(true);
    try {
      // Build patch of cherry-picked field values (only non-undefined entries).
      const patch: Record<string, any> = {};
      for (const f of MERGE_FIELDS) {
        const v = (merged as any)[f];
        patch[f as string] = v ?? null;
      }

      // Single-transaction atomic merge — repoints stakeholders / campaign
      // memberships / communications / variant assignments / action items and
      // deletes losers in one txn. No half-merged state on failure.
      const loserIds = losers.map((l) => l.id);
      const { data: summary, error } = await supabase.rpc('merge_contacts_cascade', {
        p_survivor_id: survivor.id,
        p_loser_ids: loserIds,
        p_patch: patch,
      });
      if (error) throw error;

      await logBulkDelete("contacts", loserIds.length, loserIds);
      const s = (summary || {}) as Record<string, number>;
      const parts = [
        `Kept "${survivor.contact_name || "(unnamed)"}", removed ${s.deleted ?? loserIds.length} duplicate${(s.deleted ?? loserIds.length) !== 1 ? "s" : ""}`,
        s.stakeholders_repointed ? `${s.stakeholders_repointed} stakeholder(s)` : null,
        s.campaign_contacts_repointed ? `${s.campaign_contacts_repointed} campaign(s)` : null,
        s.campaign_communications ? `${s.campaign_communications} comm(s)` : null,
      ].filter(Boolean);
      const dropped = (s.stakeholders_dropped ?? 0) + (s.campaign_contacts_dropped ?? 0) + (s.variants_dropped ?? 0);
      toast({
        title: "Merged",
        description: parts.join(" · ") + (dropped ? ` (${dropped} deduped)` : ""),
      });
      onMerged();
    } catch (e: any) {
      console.error("[contact-merge]", e);
      toast({ title: "Merge failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5" /> Merge {contacts.length} contacts — Step {step} of 2
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Pick the survivor (record to keep) and cherry-pick which field value wins."
              : "Review the exact link transfer below. Nothing is written until you confirm."}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-3">
          {step === 1 ? (
            <div className="space-y-4">
              <RadioGroup value={survivorId} onValueChange={setSurvivorId} className="space-y-2">
                {contacts.map((c) => {
                  const links = totalOf(linkCounts[c.id]);
                  const lc = linkCounts[c.id];
                  return (
                    <label
                      key={c.id}
                      htmlFor={`s-${c.id}`}
                      className={`flex items-start gap-3 border rounded-md p-3 cursor-pointer ${survivorId === c.id ? "border-primary bg-primary/5" : ""}`}
                    >
                      <RadioGroupItem id={`s-${c.id}`} value={c.id} className="mt-1" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{c.contact_name || <em className="text-muted-foreground">(empty)</em>}</span>
                          <span className="text-xs text-muted-foreground">{links} link{links !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 grid grid-cols-4 gap-x-2">
                          <span>Deals: {lc?.deals ?? 0}</span>
                          <span>Campaigns: {lc?.campaignContacts ?? 0}</span>
                          <span>Comms: {lc?.campaignCommunications ?? 0}</span>
                          <span>Variants: {lc?.variantAssignments ?? 0}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 grid grid-cols-2 gap-x-4">
                          <span>Email: {c.email || "—"}</span>
                          <span>Phone: {c.phone_no || "—"}</span>
                          <span>Company: {c.company_name || "—"}</span>
                          <span>Position: {c.position || "—"}</span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </RadioGroup>

              {survivor && (
                <div className="border rounded-md">
                  <div className="px-3 py-2 border-b bg-muted/40 text-xs font-medium uppercase text-muted-foreground">
                    Field-level merge — pick the value that survives
                  </div>
                  <table className="w-full text-xs">
                    <thead className="text-left text-muted-foreground border-b">
                      <tr>
                        <th className="p-2">Field</th>
                        {contacts.map((c) => (
                          <th key={c.id} className={`p-2 truncate ${c.id === survivorId ? "text-primary" : ""}`}>
                            {c.contact_name || "(empty)"}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {MERGE_FIELDS.map((f) => (
                        <tr key={f as string} className="border-b">
                          <td className="p-2 font-medium">{String(f)}</td>
                          {contacts.map((c) => {
                            const val = (c as any)[f];
                            const chosen = fieldSource[f as string] === c.id;
                            return (
                              <td key={c.id} className="p-2">
                                <button
                                  onClick={() => setFieldSource((prev) => ({ ...prev, [f as string]: c.id }))}
                                  className={`w-full text-left rounded px-2 py-1 truncate ${chosen ? "bg-primary/10 border border-primary" : "border border-transparent hover:bg-muted"}`}
                                  disabled={!val}
                                  title={val ? String(val) : "empty"}
                                >
                                  {val ? String(val) : <span className="text-muted-foreground italic">empty</span>}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {survivor && (
                <div className="border rounded-md p-3 bg-primary/5 border-primary">
                  <div className="text-xs font-medium text-primary uppercase mb-1">Survivor (kept)</div>
                  <div className="font-medium">{merged.contact_name || "(empty)"}</div>
                  <div className="text-xs text-muted-foreground mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                    {MERGE_FIELDS.map((f) => (
                      <Label key={f as string} className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{String(f)}:</span>
                        <span className="truncate">{(merged as any)[f] || "—"}</span>
                      </Label>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase text-muted-foreground">Link transfer</div>
                {losers.map((l) => {
                  const lc = linkCounts[l.id];
                  const rows = [
                    ["Deals (stakeholders)", lc?.deals ?? 0],
                    ["Campaign memberships", lc?.campaignContacts ?? 0],
                    ["Communications", lc?.campaignCommunications ?? 0],
                    ["A/B assignments", lc?.variantAssignments ?? 0],
                  ] as const;
                  const total = rows.reduce((s, [, n]) => s + n, 0);
                  return (
                    <div key={l.id} className="border rounded-md p-3">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-destructive line-through">{l.contact_name || "(empty)"}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className="font-medium">{survivor?.contact_name || "(empty)"}</span>
                      </div>
                      {total === 0 ? (
                        <div className="text-xs text-muted-foreground mt-1">No links to transfer — record will be deleted directly.</div>
                      ) : (
                        <div className="text-xs mt-2 grid grid-cols-4 gap-2">
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
                <span>Duplicate links (same deal-role or same campaign) will be de-duped on repoint. Then the {losers.length} loser record{losers.length !== 1 ? "s are" : " is"} deleted. This cannot be undone from the UI (there is a 60s undo in the cleanup dialog).</span>
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

export default MergeContactsDialog;
