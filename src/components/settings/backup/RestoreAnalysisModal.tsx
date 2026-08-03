import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, CheckCircle2, Download, ShieldAlert, Upload, XCircle } from 'lucide-react';
import RestoreDiffViewer, { TableDiff, Mode } from './RestoreDiffViewer';
import UserRemapTable, { UserMappingItem } from './UserRemapTable';
import RowDiffTable from './RowDiffTable';
import { RowOverrides, summarize } from './lib/diffResolution';

export interface DiffResultWithRows {
  envelopeVersion: string;
  checksum: string | null;
  checksumOk: boolean | null;
  rawSize: number;
  tableDiffs: Array<TableDiff & {
    rowDiff?: {
      newCount: number;
      updatedCount: number;
      volatileOnlyCount?: number;
      metadataOnlyCount?: number;
      deletedCount: number;
      unchangedCount: number;
      liveFetched: number;
      liveTruncated: boolean;
      samples: Array<any>;
      rows?: Array<any>;
      rowsTruncated?: boolean;
      changedColumnSummary?: Array<{ column: string; count: number; volatile?: boolean; metadata?: boolean }>;
      error?: string;
    } | null;
  }>;
  tablesOnlyInLive: string[];
  enumDiffs: Array<{ name: string; missingValues: string[]; extraValues: string[] }>;
  userMapping: UserMappingItem[];
  userIdColumns: Array<{ table: string; column: string }>;
  backupCreatedAt: string;
  warnings?: Array<{ severity: 'info' | 'warn' | 'blocker'; table?: string; message: string }>;
  diagnostics?: {
    schemaSource?: 'admin' | 'user' | 'none';
    liveSchemaColumnCount?: number;
    backupSchemaColumnCount?: number;
  };
  partial?: boolean;
  skippedTables?: string[];
  note?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  fileName: string;
  diff: DiffResultWithRows;
  modes: Record<string, Mode>;
  setModes: React.Dispatch<React.SetStateAction<Record<string, Mode>>>;
  includeCols: Record<string, Set<string>>;
  setIncludeCols: React.Dispatch<React.SetStateAction<Record<string, Set<string>>>>;
  userMap: Record<string, string | 'skip' | 'invite'>;
  setUserMap: React.Dispatch<React.SetStateAction<Record<string, string | 'skip' | 'invite'>>>;
  rowOverrides: RowOverrides;
  setRowOverrides: React.Dispatch<React.SetStateAction<RowOverrides>>;
  onApply: () => void;
  busy: boolean;
  isSuperAdmin: boolean;
}

const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString();

const RestoreAnalysisModal = ({
  open, onClose, fileName, diff,
  modes, setModes, includeCols, setIncludeCols,
  userMap, setUserMap, rowOverrides, setRowOverrides,
  onApply, busy, isSuperAdmin,
}: Props) => {
  const [confirmText, setConfirmText] = useState('');
  const [ackBlockers, setAckBlockers] = useState(false);
  const [rowTable, setRowTable] = useState<string>(diff.tableDiffs[0]?.table || '');
  const overrideSummary = useMemo(() => summarize(rowOverrides), [rowOverrides]);

  const totals = useMemo(() => {
    let backupRows = 0, liveRows = 0, newR = 0, updR = 0, metaR = 0, delR = 0, unchR = 0;
    for (const t of diff.tableDiffs) {
      backupRows += t.backupRowCount || 0;
      liveRows += t.liveRowCount || 0;
      if (t.rowDiff) {
        newR += t.rowDiff.newCount || 0;
        updR += t.rowDiff.updatedCount || 0;
        metaR += t.rowDiff.metadataOnlyCount || 0;
        delR += t.rowDiff.deletedCount || 0;
        unchR += t.rowDiff.unchangedCount || 0;
      }
    }
    return { backupRows, liveRows, newR, updR, metaR, delR, unchR };
  }, [diff]);

  const warnings = diff.warnings || [];
  const blockers = warnings.filter((w) => w.severity === 'blocker');
  const canApply =
    isSuperAdmin &&
    confirmText === 'RESTORE' &&
    (blockers.length === 0 || ackBlockers) &&
    !busy;

  const downloadAnalysis = () => {
    const blob = new Blob([JSON.stringify(diff, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `restore-analysis-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rowTableDiff = diff.tableDiffs.find((t) => t.table === rowTable);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl h-[92vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            Deep Restore Analysis
            <span className="text-xs font-normal text-muted-foreground truncate max-w-[320px]">{fileName}</span>
            {diff.checksumOk === true && (
              <Badge className="text-[10px] bg-green-500/10 text-green-700 border-green-500/20">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Checksum OK
              </Badge>
            )}
            {diff.checksumOk === false && (
              <Badge variant="destructive" className="text-[10px]"><XCircle className="h-3 w-3 mr-1" /> Checksum mismatch</Badge>
            )}
            <Badge variant="outline" className="text-[10px]">v{diff.envelopeVersion}</Badge>
            <Badge variant="outline" className="text-[10px]">{(diff.rawSize / 1024 / 1024).toFixed(2)} MB</Badge>
            {diff.backupCreatedAt && (
              <span className="text-[10px] text-muted-foreground ml-auto">Created: {new Date(diff.backupCreatedAt).toLocaleString()}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Header counters */}
        <div className="grid grid-cols-4 lg:grid-cols-9 gap-2 px-5 py-3 border-b bg-muted/30 text-xs">
          <Stat label="Tables in file" value={diff.tableDiffs.length} />
          <Stat label="Only in live" value={diff.tablesOnlyInLive.length} />
          <Stat label="Backup rows" value={totals.backupRows} />
          <Stat label="Live rows" value={totals.liveRows} />
          <Stat label="To insert" value={totals.newR} accent="text-green-700" />
          <Stat label="To update" value={totals.updR} accent="text-amber-700" />
          <Stat label="Owner-only" value={totals.metaR} accent="text-blue-700" />
          <Stat label="In live, not in backup" value={totals.delR} accent="text-red-700" />
          <Stat label="Warnings" value={warnings.length} accent={blockers.length ? 'text-destructive' : ''} />
        </div>

        <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-5 mt-3 justify-start h-9">
            <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
            <TabsTrigger value="tables" className="text-xs">Tables & Columns</TabsTrigger>
            <TabsTrigger value="rows" className="text-xs">Row Diff</TabsTrigger>
            <TabsTrigger value="schema" className="text-xs">Schema</TabsTrigger>
            <TabsTrigger value="users" className="text-xs">Users</TabsTrigger>
            <TabsTrigger value="warnings" className="text-xs">
              Warnings {warnings.length > 0 && <Badge variant={blockers.length ? 'destructive' : 'outline'} className="ml-1.5 text-[10px] h-4">{warnings.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 min-h-0 px-5 py-3">
            <TabsContent value="overview" className="m-0 h-full">
              <ScrollArea className="h-full pr-3">
                <table className="w-full text-xs border">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5">Table</th>
                      <th className="text-right px-2 py-1.5">Backup rows</th>
                      <th className="text-right px-2 py-1.5">Live rows</th>
                      <th className="text-right px-2 py-1.5 text-green-700">New</th>
                      <th className="text-right px-2 py-1.5 text-amber-700">Updated</th>
                      <th className="text-right px-2 py-1.5 text-blue-700">Owner-only</th>
                      <th className="text-right px-2 py-1.5">Unchanged</th>
                      <th className="text-right px-2 py-1.5 text-red-700">In live not in backup</th>
                      <th className="text-left px-2 py-1.5">Top changed columns</th>
                      <th className="text-left px-2 py-1.5">Mode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.tableDiffs.map((t) => {
                      const summary = t.rowDiff?.changedColumnSummary || [];
                      const topReal = summary.filter((s) => !s.volatile && !s.metadata).slice(0, 3);
                      const topMeta = summary.filter((s) => s.metadata).slice(0, 2);
                      return (
                        <tr key={t.table} className="border-t">
                          <td className="px-2 py-1 font-mono">{t.table}</td>
                          <td className="px-2 py-1 text-right">{fmt(t.backupRowCount)}</td>
                          <td className="px-2 py-1 text-right">{fmt(t.liveRowCount)}</td>
                          <td className="px-2 py-1 text-right text-green-700">{fmt(t.rowDiff?.newCount)}</td>
                          <td className="px-2 py-1 text-right text-amber-700">{fmt(t.rowDiff?.updatedCount)}</td>
                          <td className="px-2 py-1 text-right text-blue-700">{fmt(t.rowDiff?.metadataOnlyCount)}</td>
                          <td className="px-2 py-1 text-right text-muted-foreground">{fmt(t.rowDiff?.unchangedCount)}</td>
                          <td className="px-2 py-1 text-right text-red-700">{fmt(t.rowDiff?.deletedCount)}</td>
                          <td className="px-2 py-1 text-[10px] text-muted-foreground">
                            {topReal.map((s) => (
                              <span key={s.column} className="mr-1.5">
                                <span className="font-mono">{s.column}</span> ({fmt(s.count)})
                              </span>
                            ))}
                            {topMeta.map((s) => (
                              <span key={s.column} className="mr-1.5 text-blue-700">
                                <span className="font-mono">{s.column}</span> ({fmt(s.count)})·owner
                              </span>
                            ))}
                          </td>
                          <td className="px-2 py-1">
                            <Select
                              value={modes[t.table] || 'skip'}
                              onValueChange={(v: Mode) => setModes((p) => ({ ...p, [t.table]: v }))}
                              disabled={!t.inLive}
                            >
                              <SelectTrigger className="h-6 w-36 text-[10px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="skip">Skip</SelectItem>
                                <SelectItem value="merge-upsert">Merge / upsert</SelectItem>
                                <SelectItem value="append-only">Append only</SelectItem>
                                <SelectItem value="replace">Replace</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="tables" className="m-0 h-full">
              <ScrollArea className="h-full pr-3">
                <RestoreDiffViewer
                  tableDiffs={diff.tableDiffs}
                  enumDiffs={diff.enumDiffs}
                  modes={modes} setModes={setModes}
                  includeCols={includeCols} setIncludeCols={setIncludeCols}
                />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="rows" className="m-0 h-full flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-muted-foreground">Table:</span>
                <Select value={rowTable} onValueChange={setRowTable}>
                  <SelectTrigger className="h-7 w-60 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {diff.tableDiffs.map((t) => (
                      <SelectItem key={t.table} value={t.table} className="text-xs">
                        {t.table} · {t.rowDiff
                          ? `+${t.rowDiff.newCount}/~${t.rowDiff.updatedCount}/-${t.rowDiff.deletedCount}`
                          : 'no diff'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {rowTableDiff?.rowDiff?.liveTruncated && (
                  <Badge variant="outline" className="text-[10px]">Live sample truncated</Badge>
                )}
                <div className="ml-auto text-[10px] text-muted-foreground">
                  Overrides: {overrideSummary.skipRows} skipped · {overrideSummary.overriddenRows} rows · {overrideSummary.overriddenCols} cols
                </div>
              </div>
              {!rowTableDiff?.rowDiff ? (
                <div className="p-4 text-xs text-muted-foreground border rounded">No row-level diff available for this table.</div>
              ) : rowTableDiff.rowDiff.error ? (
                <div className="p-4 text-xs text-destructive border rounded">Row diff error: {rowTableDiff.rowDiff.error}</div>
              ) : (
                <RowDiffTable
                  table={rowTable}
                  rows={(rowTableDiff.rowDiff.rows || rowTableDiff.rowDiff.samples || []) as any[]}
                  rowsTruncated={rowTableDiff.rowDiff.rowsTruncated}
                  overrides={rowOverrides}
                  setOverrides={setRowOverrides}
                />
              )}
            </TabsContent>


            <TabsContent value="schema" className="m-0 h-full">
              <ScrollArea className="h-full pr-3 space-y-3">
                <Section title="Enum mismatches">
                  {diff.enumDiffs.length === 0
                    ? <div className="text-xs text-muted-foreground">No enum differences.</div>
                    : diff.enumDiffs.map((e) => (
                      <div key={e.name} className="text-xs border rounded p-2">
                        <div className="font-mono font-medium">{e.name}</div>
                        {e.missingValues.length > 0 && <div className="text-amber-700">Missing in live: {e.missingValues.join(', ')}</div>}
                        {e.extraValues.length > 0 && <div className="text-muted-foreground">Extra in live: {e.extraValues.join(', ')}</div>}
                      </div>
                    ))}
                </Section>
                <Section title="Tables present only in live (not in backup)">
                  {diff.tablesOnlyInLive.length === 0
                    ? <div className="text-xs text-muted-foreground">None.</div>
                    : <div className="text-xs font-mono">{diff.tablesOnlyInLive.join(', ')}</div>}
                </Section>
                <Section title="Auth user FK columns (will be remapped)">
                  {diff.userIdColumns.length === 0
                    ? <div className="text-xs text-muted-foreground">None detected.</div>
                    : (
                      <div className="text-xs grid grid-cols-2 gap-1 font-mono">
                        {diff.userIdColumns.map((u) => <div key={`${u.table}.${u.column}`}>{u.table}.{u.column}</div>)}
                      </div>
                    )}
                </Section>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="users" className="m-0 h-full">
              <ScrollArea className="h-full pr-3">
                <UserRemapTable mapping={diff.userMapping} userMap={userMap} setUserMap={setUserMap} />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="warnings" className="m-0 h-full">
              <ScrollArea className="h-full pr-3">
                {warnings.length === 0 ? (
                  <div className="text-xs text-muted-foreground p-3 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" /> No warnings detected.
                  </div>
                ) : (
                  <ul className="text-xs space-y-1">
                    {warnings.map((w, i) => (
                      <li key={i} className={`flex items-start gap-2 border rounded p-2 ${
                        w.severity === 'blocker' ? 'border-destructive bg-destructive/5' :
                        w.severity === 'warn' ? 'border-amber-500/30 bg-amber-500/5' :
                        'border-border'
                      }`}>
                        <AlertTriangle className={`h-3.5 w-3.5 mt-0.5 ${
                          w.severity === 'blocker' ? 'text-destructive' :
                          w.severity === 'warn' ? 'text-amber-700' : 'text-muted-foreground'
                        }`} />
                        <div>
                          {w.table && <span className="font-mono text-[10px] text-muted-foreground mr-1.5">[{w.table}]</span>}
                          {w.message}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </TabsContent>
          </div>
        </Tabs>

        {/* Footer */}
        <div className="border-t px-5 py-3 space-y-2 bg-background">
          {blockers.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-destructive">
              <input type="checkbox" checked={ackBlockers} onChange={(e) => setAckBlockers(e.target.checked)} />
              I understand there are {blockers.length} blocker warning(s) and want to proceed anyway.
            </label>
          )}
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2">
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder='Type "RESTORE" to enable'
                className="h-8 max-w-[260px] text-xs"
              />
              {!isSuperAdmin && (
                <span className="text-[11px] text-destructive">Super-admin role required to apply restore.</span>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={downloadAnalysis}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export analysis
            </Button>
            <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>Close</Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!canApply}
              onClick={onApply}
            >
              <Upload className="h-3.5 w-3.5 mr-1.5" /> Approve & Apply Restore
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Stat = ({ label, value, accent }: { label: string; value: number; accent?: string }) => (
  <div className="border rounded p-2 bg-background">
    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
    <div className={`text-base font-semibold ${accent || ''}`}>{value.toLocaleString()}</div>
  </div>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-1.5 mb-4">
    <div className="text-xs font-semibold">{title}</div>
    {children}
  </div>
);

const RowSample = ({ sample }: { sample: any }) => {
  if (sample.status === 'new') {
    return (
      <div className="p-2">
        <div className="flex items-center gap-2 mb-1">
          <Badge className="text-[10px] bg-green-500/10 text-green-700 border-green-500/20">NEW</Badge>
          <span className="font-mono text-[10px] text-muted-foreground">id: {String(sample.id)}</span>
        </div>
        <pre className="text-[10px] bg-muted/40 p-1.5 rounded overflow-x-auto">{JSON.stringify(sample.backup, null, 2).slice(0, 800)}</pre>
      </div>
    );
  }
  if (sample.status === 'deleted') {
    return (
      <div className="p-2">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="destructive" className="text-[10px]">IN LIVE, NOT IN BACKUP</Badge>
          <span className="font-mono text-[10px] text-muted-foreground">id: {String(sample.id)}</span>
        </div>
        <pre className="text-[10px] bg-muted/40 p-1.5 rounded overflow-x-auto">{JSON.stringify(sample.live, null, 2).slice(0, 800)}</pre>
      </div>
    );
  }
  // updated
  return (
    <div className="p-2">
      <div className="flex items-center gap-2 mb-1">
        <Badge className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/20">UPDATED</Badge>
        <span className="font-mono text-[10px] text-muted-foreground">id: {String(sample.id)}</span>
        <span className="text-[10px] text-muted-foreground">· {Object.keys(sample.changedColumns).length} column(s)</span>
      </div>
      <table className="w-full text-[10px] border">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left px-1.5 py-1">Column</th>
            <th className="text-left px-1.5 py-1">Live (current)</th>
            <th className="text-left px-1.5 py-1">Backup (new)</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(sample.changedColumns as Record<string, { live: any; backup: any }>).map(([col, v]) => (
            <tr key={col} className="border-t align-top">
              <td className="px-1.5 py-1 font-mono">{col}</td>
              <td className="px-1.5 py-1 font-mono text-red-700 break-all">{JSON.stringify(v.live)?.slice(0, 200)}</td>
              <td className="px-1.5 py-1 font-mono text-green-700 break-all">{JSON.stringify(v.backup)?.slice(0, 200)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default RestoreAnalysisModal;
