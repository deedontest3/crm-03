import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import type { CleanupFinding } from '@/hooks/useDatabaseCleanup';

export type MergePlan = Array<{ survivorId: string; loserIds: string[] }>;

interface Props {
  open: boolean;
  finding: CleanupFinding | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onMerge: (plan: MergePlan) => Promise<void>;
}

type Row = Record<string, any> & { id: string };
type Action = 'keep' | 'merge' | 'ignore';
type Assignment = { action: Action; targetId?: string };

export default function MergeDialog({ open, finding, loading, onOpenChange, onMerge }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({});
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!open || !finding) return;
    setFetching(true);
    (async () => {
      const { data } = await (supabase as any)
        .from(finding.table)
        .select('*')
        .in('id', finding.recordIds);
      const list: Row[] = Array.isArray(data) ? (data as Row[]) : [];
      const ts = (r: Row) =>
        new Date(r.modified_at ?? r.updated_at ?? r.created_at ?? 0).getTime() || 0;
      const sorted = [...list].sort((a, b) => ts(b) - ts(a));
      setRows(sorted);
      // Default every row to Ignore; preselect the most-recent as Keep as a hint.
      const initial: Record<string, Assignment> = {};
      for (const r of sorted) initial[r.id] = { action: 'ignore' };
      if (sorted[0]) initial[sorted[0].id] = { action: 'keep' };
      setAssignments(initial);
      setFetching(false);
    })();
  }, [open, finding]);

  const nameField = finding?.module === 'accounts' ? 'account_name'
    : finding?.module === 'contacts' ? 'contact_name'
    : finding?.module === 'deals' ? 'deal_name'
    : finding?.module === 'campaigns' ? 'campaign_name'
    : 'title';

  const survivors = useMemo(
    () => rows.filter((r) => assignments[r.id]?.action === 'keep'),
    [rows, assignments]
  );

  const setAction = (id: string, action: Action) => {
    setAssignments((prev) => {
      const next: Record<string, Assignment> = { ...prev, [id]: { action } };
      // If a survivor is demoted, drop any "merge into" pointing at it.
      if (action !== 'keep') {
        for (const key of Object.keys(next)) {
          if (next[key].action === 'merge' && next[key].targetId === id) {
            next[key] = { action: 'merge', targetId: undefined };
          }
        }
      }
      return next;
    });
  };

  const setTarget = (id: string, targetId: string) => {
    setAssignments((prev) => ({ ...prev, [id]: { action: 'merge', targetId } }));
  };

  const kept = survivors.length;
  const mergedRows = rows.filter((r) => {
    const a = assignments[r.id];
    return a?.action === 'merge' && a.targetId && survivors.some((s) => s.id === a.targetId);
  });
  const mergedCount = mergedRows.length;
  const ignoredCount = rows.length - kept - mergedCount - rows.filter((r) => {
    const a = assignments[r.id];
    return a?.action === 'merge' && (!a.targetId || !survivors.some((s) => s.id === a.targetId));
  }).length;
  const unresolvedMerges = rows.some((r) => {
    const a = assignments[r.id];
    return a?.action === 'merge' && (!a.targetId || !survivors.some((s) => s.id === a.targetId));
  });

  const canMerge = kept >= 1 && mergedCount >= 1 && !unresolvedMerges;

  const buildPlan = (): MergePlan => {
    const bySurvivor = new Map<string, string[]>();
    for (const r of rows) {
      const a = assignments[r.id];
      if (a?.action === 'merge' && a.targetId) {
        const list = bySurvivor.get(a.targetId) || [];
        list.push(r.id);
        bySurvivor.set(a.targetId, list);
      }
    }
    return Array.from(bySurvivor.entries()).map(([survivorId, loserIds]) => ({ survivorId, loserIds }));
  };

  const rowLabel = (r: Row) => r[nameField] || '(unnamed)';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Merge duplicates</DialogTitle>
          <DialogDescription>
            For each record, choose <b>Keep</b> (survives), <b>Merge into…</b> (folded into a survivor), or <b>Ignore</b> (left alone).
            You can keep multiple records — e.g. one per country — and only merge the ones you pick.
          </DialogDescription>
        </DialogHeader>

        {fetching ? (
          <p className="text-sm text-muted-foreground py-4">Loading records…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Could not load these records — you may not have permission to read them directly.
          </p>
        ) : (
          <div className="space-y-2 py-2 max-h-[60vh] overflow-y-auto">
            {rows.map((r) => {
              const a = assignments[r.id] || { action: 'ignore' as Action };
              const badTarget = a.action === 'merge' && (!a.targetId || !survivors.some((s) => s.id === a.targetId));
              return (
                <div key={r.id} className="flex items-start gap-3 rounded-md border p-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{rowLabel(r)}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {r.country && <>{r.country} · </>}
                      {r.website || r.email || ''}
                      {r.modified_at && <> · Modified {new Date(r.modified_at).toLocaleDateString()}</>}
                    </div>
                  </div>
                  <Select value={a.action} onValueChange={(v: Action) => setAction(r.id, v)}>
                    <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keep">Keep</SelectItem>
                      <SelectItem value="merge">Merge into…</SelectItem>
                      <SelectItem value="ignore">Ignore</SelectItem>
                    </SelectContent>
                  </Select>
                  {a.action === 'merge' && (
                    <Select
                      value={a.targetId ?? ''}
                      onValueChange={(v) => setTarget(r.id, v)}
                    >
                      <SelectTrigger className={`h-8 w-48 text-xs ${badTarget ? 'border-destructive text-destructive' : ''}`}>
                        <SelectValue placeholder="Pick survivor…" />
                      </SelectTrigger>
                      <SelectContent>
                        {survivors.filter((s) => s.id !== r.id).map((s) => (
                          <SelectItem key={s.id} value={s.id}>{rowLabel(s)}</SelectItem>
                        ))}
                        {survivors.filter((s) => s.id !== r.id).length === 0 && (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">Mark a row as Keep first</div>
                        )}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row sm:items-center gap-2">
          <div className="text-xs text-muted-foreground mr-auto">
            {kept} kept · {mergedCount} merged · {ignoredCount} ignored
            {unresolvedMerges && <span className="text-destructive"> · assign a survivor to every “Merge into” row</span>}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => onMerge(buildPlan())}
            disabled={loading || fetching || !canMerge}
          >
            Merge {mergedCount} record{mergedCount === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
