import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { RotateCcw, RefreshCw, CheckCircle2, XCircle, Trash2, Eye } from 'lucide-react';
import RestoreAnalysisModal, { DiffResultWithRows } from './RestoreAnalysisModal';
import { Mode } from './RestoreDiffViewer';
import { RowOverrides } from './lib/diffResolution';


type DiffResult = DiffResultWithRows;

const AdvancedRestorePanel = () => {
  const { user } = useAuth();
  const { isSuperAdmin } = useUserRole();
  const [uploadPath, setUploadPath] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'analyzing' | 'restoring'>('idle');
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [includeCols, setIncludeCols] = useState<Record<string, Set<string>>>({});
  const [userMap, setUserMap] = useState<Record<string, string | 'skip' | 'invite'>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [rowOverrides, setRowOverrides] = useState<RowOverrides>({});


  const isLegacy = diff?.envelopeVersion === '1.0';

  const isNoResponseError = (error: any): boolean => {
    const ctx = error?.context;
    const status: number | undefined = ctx?.status ?? error?.status;
    const name = error?.name || '';
    const msg = error?.message || '';
    return (
      name === 'FunctionsFetchError' ||
      msg === 'Failed to send a request to the Edge Function' ||
      /Failed to fetch|NetworkError|ERR_FAILED/i.test(msg) ||
      status === 0
    );
  };

  // Retry invokes when the gateway returns no response (cold start / redeploy).
  // Only retries "no response" errors — never 4xx/5xx with a body.
  const invokeWithRetry = async (
    fn: string,
    options: { method: 'POST' | 'GET' | 'PUT' | 'PATCH' | 'DELETE'; body: any },
    maxAttempts = 3,
  ): Promise<{ data: any; error: any }> => {
    let last: { data: any; error: any } = { data: null, error: null };
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await supabase.functions.invoke(fn, options);
      last = res;
      if (!res.error) return res;
      if (!isNoResponseError(res.error) || attempt === maxAttempts) return res;
      await new Promise((r) => setTimeout(r, 2000));
    }
    return last;
  };

  const extractInvokeError = async (error: any, fallback: string): Promise<string> => {
    try {
      const ctx = error?.context;
      const status: number | undefined = ctx?.status ?? error?.status;
      const msg = error?.message || '';

      if (isNoResponseError(error)) {
        return "Couldn't reach the backup service after several attempts. The function may be redeploying — please retry in ~30 seconds, or check the Edge Functions dashboard.";
      }

      if (ctx && typeof ctx.clone === 'function') {
        try {
          const body = await ctx.clone().json();
          if (body?.error) return String(body.error);
          if (body?.message) return String(body.message);
        } catch {
          try {
            const txt = await ctx.clone().text();
            if (txt) return `${status ? `[${status}] ` : ''}${txt.slice(0, 500)}`;
          } catch {}
        }
      }
      if (status) return `[${status}] ${msg || fallback}`;
      return msg || fallback;
    } catch {
      return error?.message || fallback;
    }
  };


  // Poll backup_jobs row until terminal status. Resolves with result on completed,
  // rejects on failed/timeout.
  const pollJob = async (jobId: string, timeoutMs = 180_000): Promise<any> => {
    const started = Date.now();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    while (Date.now() - started < timeoutMs) {
      const { data, error } = await (supabase as any)
        .from('backup_jobs')
        .select('status, result, error, progress')
        .eq('id', jobId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) { await sleep(1500); continue; }
      if (data.status === 'completed') return data.result;
      if (data.status === 'failed') throw new Error(data.error || 'Job failed');
      await sleep(1500);
    }
    throw new Error('Job is taking longer than expected — please check back in a minute.');
  };

  const reset = () => {
    setUploadPath(null); setFileName(''); setDiff(null); setResult(null);
    setModes({}); setIncludeCols({}); setUserMap({}); setRowOverrides({});
  };

  const discardUpload = async () => {
    if (uploadPath) {
      try { await supabase.storage.from('backups').remove([uploadPath]); } catch {}
    }
    reset();
  };

  const reanalyzeSkipped = async () => {
    if (!uploadPath || !diff?.skippedTables?.length) return;
    setBusy(true);
    setPhase('analyzing');
    try {
      const { data: enq, error } = await invokeWithRetry('diff-backup', {
        method: 'POST', body: { uploadPath, onlyTables: diff.skippedTables },
      });
      if (error) throw new Error(await extractInvokeError(error, 'diff-backup failed'));
      if ((enq as any)?.error) throw new Error((enq as any).error);
      const jobId = (enq as any)?.jobId;
      if (!jobId) throw new Error('No jobId returned from diff-backup');
      const more = (await pollJob(jobId)) as DiffResult;
      setDiff((prev) => {
        if (!prev) return more;
        const byTable = new Map(prev.tableDiffs.map((t) => [t.table, t]));
        for (const t of more.tableDiffs) byTable.set(t.table, t);
        return {
          ...prev,
          tableDiffs: Array.from(byTable.values()),
          partial: more.partial ?? false,
          skippedTables: more.skippedTables ?? [],
          note: more.note,
        };
      });
      setModes((prev) => {
        const next = { ...prev };
        for (const t of more.tableDiffs) if (!(t.table in next)) next[t.table] = t.inLive ? 'merge-upsert' : 'skip';
        return next;
      });
      setIncludeCols((prev) => {
        const next = { ...prev };
        for (const t of more.tableDiffs) if (!(t.table in next)) next[t.table] = new Set(t.matching);
        return next;
      });
      toast.success('Re-analysis complete');
    } catch (e: any) {
      console.error('reanalyze error:', e);
      toast.error(e.message || 'Re-analyze failed');
    } finally {
      setBusy(false);
      setPhase('idle');
    }
  };

  const handleFile = async (file: File) => {
    if (!user) { toast.error('Not signed in'); return; }
    setBusy(true);
    setPhase('uploading');
    setDiff(null);
    setResult(null);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `restore-uploads/${user.id}/${crypto.randomUUID()}-${safeName}`;
    try {
      const { error: upErr } = await supabase.storage.from('backups').upload(path, file, {
        upsert: false,
        contentType: file.name.endsWith('.gz') ? 'application/gzip' : 'application/json',
      });
      if (upErr) {
        console.error('backup restore upload error:', upErr);
        throw new Error(upErr.message || 'Failed to upload backup file');
      }
      setUploadPath(path);
      setFileName(file.name);

      setPhase('analyzing');
      const { data: enq, error } = await invokeWithRetry('diff-backup', {
        method: 'POST', body: { uploadPath: path },
      });
      if (error) {
        const msg = await extractInvokeError(error, 'diff-backup failed');
        throw new Error(msg);
      }
      if ((enq as any)?.error) throw new Error((enq as any).error);
      const jobId = (enq as any)?.jobId;
      if (!jobId) throw new Error('No jobId returned from diff-backup');
      const d = (await pollJob(jobId)) as DiffResult;
      setDiff(d);

      const initModes: Record<string, Mode> = {};
      const initCols: Record<string, Set<string>> = {};
      for (const t of d.tableDiffs) {
        initModes[t.table] = t.inLive ? 'merge-upsert' : 'skip';
        initCols[t.table] = new Set(t.matching);
      }
      setModes(initModes);
      setIncludeCols(initCols);

      const initMap: Record<string, string | 'skip' | 'invite'> = {};
      for (const m of d.userMapping) initMap[m.sourceId] = m.targetId ?? 'skip';
      setUserMap(initMap);

      toast.success('Backup analyzed');
    } catch (e: any) {
      console.error('Advanced restore upload/diff error:', e);
      toast.error(e.message || 'Failed to upload / analyze backup');
      try { await supabase.storage.from('backups').remove([path]); } catch {}
      setUploadPath(null);
    } finally {
      setBusy(false);
      setPhase('idle');
    }
  };

  const applyRestore = async () => {
    if (!uploadPath || !diff) return;
    setBusy(true);
    setPhase('restoring');
    setModalOpen(false);
    try {
      const plan = {
        tables: diff.tableDiffs.map((t) => ({
          name: t.table,
          mode: modes[t.table] || 'skip',
          includeColumns: Array.from(includeCols[t.table] || []),
        })),
        userRemap: userMap,
        userIdColumns: diff.userIdColumns,
        rowOverrides,
        skipVolatileColumns: true,
        skipMetadataColumns: true,
      };
      const { data: enq, error } = await invokeWithRetry('restore-advanced-backup', {
        method: 'POST', body: { uploadPath, plan, requireChecksum: false },
      });
      if (error) {
        const msg = await extractInvokeError(error, 'restore failed');
        throw new Error(msg);
      }
      if ((enq as any)?.error) throw new Error((enq as any).error);
      const jobId = (enq as any)?.jobId;
      if (!jobId) throw new Error('No jobId returned from restore-advanced-backup');
      const data = await pollJob(jobId, 10 * 60_000);
      setResult(data);
      setUploadPath(null);
      toast.success('Restore completed — safety snapshot was created');
    } catch (e: any) {
      console.error('Restore error:', e);
      toast.error(e.message || 'Restore failed');
    } finally {
      setBusy(false);
      setPhase('idle');
    }
  };

  const phaseLabel =
    phase === 'uploading' ? 'Uploading file…'
    : phase === 'analyzing' ? 'Analyzing backup…'
    : phase === 'restoring' ? 'Restoring…'
    : '';

  const warningCount = diff?.warnings?.length || 0;
  const blockerCount = diff?.warnings?.filter((w) => w.severity === 'blocker').length || 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <RotateCcw className="h-4 w-4" /> Advanced Restore
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex-1 min-w-[200px]">
            <Input
              type="file"
              accept=".json,.gz,application/json,application/gzip"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              className="h-9 text-xs"
              disabled={busy}
            />
          </label>
          {fileName && <Badge variant="outline" className="text-xs max-w-[180px] truncate">{fileName}</Badge>}
          {isLegacy && (
            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/20">Legacy v1.0</Badge>
          )}
          {diff?.checksumOk === true && (
            <Badge className="text-xs bg-green-500/10 text-green-700 border-green-500/20">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Checksum OK
            </Badge>
          )}
          {diff?.checksumOk === false && (
            <Badge variant="destructive" className="text-xs"><XCircle className="h-3 w-3 mr-1" /> Checksum mismatch</Badge>
          )}
          {uploadPath && !busy && (
            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={discardUpload} title="Discard upload">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {busy && (
          <div className="flex items-center justify-center py-6 text-muted-foreground text-xs">
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> {phaseLabel}
          </div>
        )}

        {diff && !busy && (
          <div className="rounded border p-3 space-y-2 bg-muted/20">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <Mini label="Tables" value={diff.tableDiffs.length} />
              <Mini label="Only in live" value={diff.tablesOnlyInLive.length} />
              <Mini label="Unmapped users" value={diff.userMapping.filter((m) => !m.targetId).length} />
              <Mini label="Warnings" value={warningCount} accent={blockerCount ? 'text-destructive' : warningCount ? 'text-amber-700' : ''} />
            </div>
            {diff.partial && (diff.skippedTables?.length ?? 0) > 0 && (
              <div className="text-[11px] text-amber-700 flex items-center justify-between gap-2">
                <span>{diff.note || `${diff.skippedTables!.length} table(s) skipped due to time budget.`}</span>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={reanalyzeSkipped}>
                  <RefreshCw className="h-3 w-3 mr-1" /> Re-analyze
                </Button>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={discardUpload}>Discard</Button>
              <Button size="sm" onClick={() => setModalOpen(true)} disabled={busy}>
                <Eye className="h-3.5 w-3.5 mr-1.5" /> Open Deep Analysis
              </Button>
            </div>
          </div>
        )}

        {result && (
          <div className="border rounded p-2 text-xs space-y-1">
            <div className="font-medium flex items-center gap-1.5 text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Restore complete
            </div>
            {result.safetyBackup && <div className="text-muted-foreground">Safety snapshot: {result.safetyBackup}</div>}
            {result.inviteResults?.length > 0 && (
              <div className="text-muted-foreground">
                Invites: {result.inviteResults.filter((r: any) => r.targetId).length}/{result.inviteResults.length} resolved
              </div>
            )}
            <div className="max-h-40 overflow-auto">
              {result.results?.map((r: any) => (
                <div key={r.table} className="flex justify-between border-b py-0.5">
                  <span className="font-mono">{r.table}</span>
                  <span className="text-muted-foreground">{r.mode} · ✓{r.inserted} ⊘{r.skipped} ✗{r.errors}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      {diff && (
        <RestoreAnalysisModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          fileName={fileName}
          diff={diff}
          modes={modes} setModes={setModes}
          includeCols={includeCols} setIncludeCols={setIncludeCols}
          userMap={userMap} setUserMap={setUserMap}
          rowOverrides={rowOverrides} setRowOverrides={setRowOverrides}
          onApply={applyRestore}
          busy={busy}
          isSuperAdmin={isSuperAdmin}
        />
      )}
    </Card>
  );
};

const Mini = ({ label, value, accent }: { label: string; value: number; accent?: string }) => (
  <div className="border rounded p-2 bg-background">
    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
    <div className={`text-base font-semibold ${accent || ''}`}>{value.toLocaleString()}</div>
  </div>
);

export default AdvancedRestorePanel;

