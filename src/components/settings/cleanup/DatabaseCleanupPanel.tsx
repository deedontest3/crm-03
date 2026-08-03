import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { RefreshCw, Database, AlertTriangle, Trash2, Download } from "lucide-react";
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDatabaseCleanup, type CleanupFinding, type CleanupRule } from '@/hooks/useDatabaseCleanup';
import FindingCard from './FindingCard';
import MergeDialog, { type MergePlan } from './MergeDialog';
import FixFieldsDialog from './FixFieldsDialog';
import { AppLoader } from "@/components/ui/loader";

const MODULE_LABELS: Record<string, string> = {
  accounts: 'Accounts',
  contacts: 'Contacts',
  deals: 'Deals',
  campaigns: 'Campaigns',
  action_items: 'Action Items',
  notifications: 'Notifications',
  settings: 'Settings',
  logs: 'Logs & Audit',
  backups: 'Backups',
  auth: 'Auth / Users',
  system: 'System',
};

const ALL_MODULE_KEYS = Object.keys(MODULE_LABELS);

const RULE_OPTIONS: Array<{ value: CleanupRule | 'all'; label: string }> = [
  { value: 'all', label: 'All issue types' },
  { value: 'duplicate', label: 'Duplicates' },
  { value: 'incomplete', label: 'Incomplete' },
  { value: 'orphan', label: 'Orphans' },
  { value: 'stale', label: 'Stale' },
];

export default function DatabaseCleanupPanel() {
  const { report, loading, acting, runScan, performAction, dismissed, dismissFinding, removeFindings } = useDatabaseCleanup();
  const [activeModule, setActiveModule] = useState<string>('all');
  const [ruleFilter, setRuleFilter] = useState<CleanupRule | 'all'>('all');
  const [mergeFinding, setMergeFinding] = useState<CleanupFinding | null>(null);
  const [fixFinding, setFixFinding] = useState<CleanupFinding | null>(null);
  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set(ALL_MODULE_KEYS));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState('');

  const visible = useMemo(() => {
    if (!report) return [];
    return report.findings.filter((f) =>
      !dismissed.has(f.id) &&
      (activeModule === 'all' || f.module === activeModule) &&
      (ruleFilter === 'all' || f.rule === ruleFilter)
    );
  }, [report, dismissed, activeModule, ruleFilter]);

  const toggleModule = (key: string) => {
    setSelectedModules((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleAllModules = (on: boolean) => {
    setSelectedModules(on ? new Set(ALL_MODULE_KEYS) : new Set());
  };

  const toggleFinding = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Aggregate rows ("N more hidden by cap") are informational; never let users
  // select or bulk-act on them — they have no recordIds and a fake table name.
  const isActionable = (f: CleanupFinding) =>
    !f.aggregate && f.recordIds && f.recordIds.length > 0;
  const actionableVisible = useMemo(() => visible.filter(isActionable), [visible]);
  const allVisibleSelected =
    actionableVisible.length > 0 && actionableVisible.every((f) => selectedIds.has(f.id));
  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const f of actionableVisible) next.delete(f.id);
      } else {
        for (const f of actionableVisible) next.add(f.id);
      }
      return next;
    });
  };

  const handleScan = () => {
    const mods = Array.from(selectedModules);
    if (mods.length === 0) return;
    setSelectedIds(new Set());
    runScan(mods.length === ALL_MODULE_KEYS.length ? undefined : mods);
  };

  const handleDelete = async (f: CleanupFinding) => {
    await performAction('delete', f.table, f.recordIds);
    removeFindings([f.id]);
  };

  const handleMerge = async (plan: MergePlan) => {
    if (!mergeFinding || plan.length === 0) return;
    try {
      for (const { survivorId, loserIds } of plan) {
        await performAction('merge', mergeFinding.table, loserIds, { survivorId });
      }
      removeFindings([mergeFinding.id]);
      setMergeFinding(null);
    } catch {
      // performAction already toasted the failure; keep the dialog open so the user can retry.
    }
  };

  const handleFix = async (payload: Record<string, any>) => {
    if (!fixFinding) return;
    await performAction('patch', fixFinding.table, fixFinding.recordIds, { payload });
    removeFindings([fixFinding.id]);
    setFixFinding(null);
  };

  const handleBulkDelete = async () => {
    if (!report) return;
    const selected = report.findings.filter((f) => selectedIds.has(f.id) && isActionable(f));
    // Group ids by table; ensures we issue one delete per table.
    const byTable = new Map<string, { ids: Set<string>; findingIds: string[] }>();
    for (const f of selected) {
      const entry = byTable.get(f.table) || { ids: new Set<string>(), findingIds: [] };
      for (const id of f.recordIds) entry.ids.add(id);
      entry.findingIds.push(f.id);
      byTable.set(f.table, entry);
    }
    const removed: string[] = [];
    const failures: string[] = [];
    for (const [table, { ids, findingIds }] of byTable) {
      try {
        await performAction('delete', table, Array.from(ids));
        removed.push(...findingIds);
      } catch {
        failures.push(table);
      }
    }
    removeFindings(removed);
    if (failures.length === 0) {
      // success toast already shown per-table
    } else if (removed.length === 0) {
      // every table failed — per-action toasts already fired
    } else {
      // partial — surface a summary the user can act on
      // eslint-disable-next-line no-alert
      console.warn(`Bulk delete partially failed: ${failures.join(', ')}`);
    }
    setSelectedIds(new Set());
    setBulkConfirm('');
  };

  const handleExportCsv = () => {
    if (!report) return;
    const header = ['id', 'module', 'table', 'rule', 'severity', 'title', 'description', 'recordIds'];
    // CSV injection guard: prefix any cell starting with =, +, -, @ with a leading
    // apostrophe so spreadsheet apps don't evaluate it as a formula.
    const escape = (v: any) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = visible.map((f) => [
      f.id, f.module, f.table, f.rule, f.severity, f.title, f.description, f.recordIds.join('|'),
    ].map(escape).join(','));
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cleanup-findings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const overflowTotal = report?.overflow
    ? Object.values(report.overflow).reduce((sum, n) => sum + n, 0)
    : 0;
  const aggregateCount = useMemo(
    () => (report?.findings ?? []).filter((f) => f.aggregate || f.recordIds.length === 0).length,
    [report]
  );

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" /> Database Cleanup
              </CardTitle>
              <CardDescription>
                Scan selected modules for duplicates, incomplete records, orphaned references, and stale data.
                Select unwanted records and delete them in bulk.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 text-sm">
              {report && (
                <span className="text-muted-foreground">
                  Last scan: {new Date(report.scannedAt).toLocaleString()} · {report.total} issue(s)
                </span>
              )}
              <Button onClick={handleScan} disabled={loading || selectedModules.size === 0}>
                {loading ? <AppLoader variant="inline" className="mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                {report ? 'Re-scan selected' : 'Scan selected'}
              </Button>
            </div>
          </div>

          {/* Module picker */}
          <div className="mt-4 rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Modules to scan ({selectedModules.size}/{ALL_MODULE_KEYS.length})
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => toggleAllModules(true)}>All</Button>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => toggleAllModules(false)}>None</Button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {ALL_MODULE_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={selectedModules.has(k)} onCheckedChange={() => toggleModule(k)} />
                  <span>{MODULE_LABELS[k]}</span>
                </label>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {!report && !loading && (
            <div className="py-12 text-center text-muted-foreground">
              <Database className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>Pick the modules above and click <strong>Scan selected</strong> to detect cleanup opportunities.</p>
            </div>
          )}

          {loading && (
            <div className="py-10 text-center space-y-3">
              <AppLoader variant="inline" className="mx-auto" />
              <div className="text-sm font-medium">Scanning…</div>
              <div className="text-xs text-muted-foreground">This usually finishes in a few seconds.</div>
            </div>
          )}

          {report && (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
              {/* Sidebar: module counts */}
              <div className="lg:col-span-1 space-y-1">
                <button
                  className={`w-full text-left px-3 py-2 rounded-md text-sm flex justify-between items-center ${activeModule === 'all' ? 'bg-accent' : 'hover:bg-accent/50'}`}
                  onClick={() => setActiveModule('all')}
                >
                  <span>All modules</span>
                  <Badge variant="secondary">{report.total}</Badge>
                </button>
                {Object.entries(MODULE_LABELS).map(([key, label]) => {
                  const count = report.totals[key] || 0;
                  if (count === 0 && !(report.modules || []).includes(key)) return null;
                  return (
                    <button
                      key={key}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm flex justify-between items-center ${activeModule === key ? 'bg-accent' : 'hover:bg-accent/50'}`}
                      onClick={() => setActiveModule(key)}
                    >
                      <span>{label}</span>
                      <Badge variant={count > 0 ? 'default' : 'outline'}>{count}</Badge>
                    </button>
                  );
                })}
                {((report.errors && Object.keys(report.errors).length > 0) ||
                  (report.truncatedTables && report.truncatedTables.length > 0) ||
                  overflowTotal > 0) && (
                  <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                    <div className="flex items-center gap-1 font-medium mb-1">
                      <AlertTriangle className="h-3 w-3" /> Scan notices
                    </div>
                    {report.errors && Object.entries(report.errors).map(([m, err]) => (
                      <div key={m}><strong>{m}</strong>: {err}</div>
                    ))}
                    {report.truncatedTables && report.truncatedTables.length > 0 && (
                      <div>Truncated (per-table fetch cap reached): {report.truncatedTables.join(', ')}</div>
                    )}
                    {overflowTotal > 0 && aggregateCount === 0 && (
                      <div>
                        <strong>{overflowTotal}</strong> additional finding(s) were hidden by the per-bucket cap (200).
                        Re-scan with fewer modules to see them.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Findings */}
              <div className="lg:col-span-3 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAllVisible} />
                    Select all visible
                  </label>
                  <Select value={ruleFilter} onValueChange={(v) => setRuleFilter(v as any)}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RULE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-muted-foreground">{visible.length} shown · {selectedIds.size} selected</span>
                  <div className="ml-auto flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={handleExportCsv} disabled={visible.length === 0}>
                      <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="destructive" disabled={acting || selectedIds.size === 0}>
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete selected ({selectedIds.size})
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete records from {selectedIds.size} finding(s)?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently removes the underlying records from their tables. A snapshot is
                            kept in the audit log for 30 days so an admin can restore.
                            Type <strong>DELETE</strong> to confirm.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <input
                          value={bulkConfirm}
                          onChange={(e) => setBulkConfirm(e.target.value)}
                          placeholder="DELETE"
                          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                        />
                        <AlertDialogFooter>
                          <AlertDialogCancel onClick={() => setBulkConfirm('')}>Cancel</AlertDialogCancel>
                          <AlertDialogAction disabled={bulkConfirm !== 'DELETE'} onClick={handleBulkDelete}>
                            Confirm delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                <ScrollArea className="h-[60vh] pr-3">
                  <div className="space-y-3">
                    {visible.length === 0 && (
                      <div className="text-center text-sm text-muted-foreground py-12">
                        No findings for this filter.
                      </div>
                    )}
                    {visible.map((f) => (
                      <div key={f.id} className="flex items-start gap-2">
                        <Checkbox
                          className="mt-4"
                          checked={selectedIds.has(f.id)}
                          disabled={!isActionable(f)}
                          onCheckedChange={() => isActionable(f) && toggleFinding(f.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <FindingCard
                            finding={f}
                            acting={acting}
                            onDelete={() => handleDelete(f)}
                            onDismiss={() => dismissFinding(f)}
                            onMerge={() => setMergeFinding(f)}
                            onFix={() => setFixFinding(f)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <MergeDialog
        open={!!mergeFinding}
        finding={mergeFinding}
        loading={acting}
        onOpenChange={(o) => !o && setMergeFinding(null)}
        onMerge={handleMerge}
      />
      <FixFieldsDialog
        open={!!fixFinding}
        finding={fixFinding}
        loading={acting}
        onOpenChange={(o) => !o && setFixFinding(null)}
        onSave={handleFix}
      />
    </>
  );
}
