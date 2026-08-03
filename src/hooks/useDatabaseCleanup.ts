import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

const CLEANUP_HEALTH_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/db-cleanup-scan?health=1`;

export type CleanupRule = 'duplicate' | 'incomplete' | 'orphan' | 'stale';
export type CleanupSeverity = 'low' | 'medium' | 'high';

export interface CleanupFinding {
  id: string;
  module: string;
  table: string;
  rule: CleanupRule;
  severity: CleanupSeverity;
  title: string;
  description: string;
  recordIds: string[];
  preview: Record<string, any>;
  missingFields?: string[];
  /** Informational aggregate row (e.g. "N more hidden by cap"). Not actionable. */
  aggregate?: boolean;
}

export interface CleanupReport {
  scannedAt: string;
  modules?: string[];
  total: number;
  totals: Record<string, number>;
  findings: CleanupFinding[];
  errors?: Record<string, string>;
  truncatedTables?: string[];
  overflow?: Record<string, number>;
  version?: string;
}

function generateRequestId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function extractInvokeError(err: any): Promise<string> {
  if (!err) return 'Unknown error';
  const ctx = err.context;
  if (ctx && typeof ctx.clone === 'function') {
    try {
      const body = await ctx.clone().json();
      if (body?.error) return String(body.error);
    } catch {
      try {
        const txt = await ctx.clone().text();
        if (txt) return txt.slice(0, 400);
      } catch { /* ignore */ }
    }
  }
  const msg = String(err.message || err);
  if (/failed to (send|fetch) a? ?request/i.test(msg) || /FunctionsFetchError/i.test(msg)) {
    return 'Cleanup backend function is not deployed or reachable. Please deploy the db-cleanup-scan function, then retry.';
  }
  return msg;
}

async function checkCleanupHealth(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(CLEANUP_HEALTH_URL, { method: 'GET' });
  } catch {
    throw new Error('Cleanup backend function is not deployed or reachable. Please deploy the db-cleanup-scan function, then retry.');
  }

  let body: any = null;
  try {
    body = await response.clone().json();
  } catch { /* non-json response */ }

  if (response.status === 404 || body?.code === 'NOT_FOUND') {
    throw new Error('Cleanup backend function is missing on the hosted backend. Deploy db-cleanup-scan, then retry.');
  }
  if (!response.ok || body?.ok !== true) {
    throw new Error(body?.error || `Cleanup backend health check failed (${response.status}).`);
  }
}

function isFetchError(err: any): boolean {
  const msg = String(err?.message || err || '');
  return /failed to (send|fetch) a? ?request/i.test(msg) || /FunctionsFetchError/i.test(msg);
}

async function invokeScanWithRetry(body: Record<string, unknown>, signal?: AbortSignal) {
  const exec = () => supabase.functions.invoke('db-cleanup-scan', { body });
  try {
    return await exec();
  } catch (e) {
    if (signal?.aborted) throw new Error('aborted');
    if (!isFetchError(e)) throw e;
    await new Promise((r) => setTimeout(r, 1500));
    return await exec();
  }
}

export function useDatabaseCleanup() {
  const [report, setReport] = useState<CleanupReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  // #6: monotonic token — only the latest scan response is allowed to update
  // state. supabase.functions.invoke ignores AbortController, so we discard
  // stale responses by id rather than relying on signal.
  const scanTokenRef = useRef(0);

  // ----- Persistent dismissals ----------------------------------------------
  const loadDismissals = useCallback(async () => {
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;
    // #20: defense-in-depth — scope by user_id explicitly even though RLS does it.
    const { data, error } = await supabase
      .from('cleanup_dismissals')
      .select('finding_id')
      .eq('user_id', user.id);
    if (error) return;
    if (data) setDismissed(new Set((data as Array<{ finding_id: string }>).map((d) => d.finding_id)));
  }, []);

  useEffect(() => { loadDismissals(); }, [loadDismissals]);

  const dismissFinding = useCallback(async (finding: CleanupFinding | string) => {
    const f = typeof finding === 'string' ? null : finding;
    const id = typeof finding === 'string' ? finding : finding.id;
    setDismissed((prev) => new Set(prev).add(id));
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) return;
      await supabase.from('cleanup_dismissals').insert({
        user_id: user.id,
        finding_id: id,
        module: f?.module ?? 'unknown',
        rule: f?.rule ?? 'unknown',
      });
    } catch (e) {
      console.error('persist dismiss failed', e);
    }
  }, []);

  const undismissFinding = useCallback(async (findingId: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.delete(findingId);
      return next;
    });
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) return;
      await supabase.from('cleanup_dismissals')
        .delete()
        .eq('user_id', user.id)
        .eq('finding_id', findingId);
    } catch (e) { console.error('undismiss failed', e); }
  }, []);

  // ----- Scan ---------------------------------------------------------------
  const runScan = useCallback(async (modules?: string[]) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const myToken = ++scanTokenRef.current;
    setLoading(true);
    try {
      await checkCleanupHealth();
      const body = modules && modules.length > 0 ? { modules } : {};
      const { data, error } = await invokeScanWithRetry(body, controller.signal);
      // #6: if a newer scan started while we were awaiting, drop this response.
      if (myToken !== scanTokenRef.current) return;
      if (controller.signal.aborted) return;
      if (error) throw error;
      if (!data || typeof data !== 'object') throw new Error('Empty scan response');
      if ((data as any).error) throw new Error((data as any).error);

      const r = data as CleanupReport;
      // #3: server totals include aggregate "N more hidden" rows; recompute
      // client-side excluding them so the sidebar matches the actionable count.
      const realFindings = r.findings.filter((f) => !f.aggregate);
      const totals: Record<string, number> = {};
      for (const m of r.modules ?? []) totals[m] = 0;
      for (const f of realFindings) totals[f.module] = (totals[f.module] || 0) + 1;
      setReport({ ...r, totals, total: realFindings.length });
      const errCount = r.errors ? Object.keys(r.errors).length : 0;
      const overflowCount = r.overflow ? Object.values(r.overflow).reduce((a, b) => a + b, 0) : 0;
      toast({
        title: 'Scan complete',
        description: `Found ${realFindings.length} issue(s) across ${r.modules?.length ?? 0} module(s)`
          + (errCount ? ` · ${errCount} module(s) errored` : '')
          + (overflowCount ? ` · ${overflowCount} additional finding(s) hidden by cap` : ''),
      });
    } catch (e: any) {
      if (myToken !== scanTokenRef.current) return;
      if (controller.signal.aborted || String(e?.message || e) === 'aborted') return;
      toast({ title: 'Scan failed', description: await extractInvokeError(e), variant: 'destructive' });
    } finally {
      if (myToken === scanTokenRef.current) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  // ----- Action wrapper -----------------------------------------------------
  const performAction = useCallback(async (
    action: 'delete' | 'merge' | 'patch',
    table: string,
    recordIds: string[],
    extra: { survivorId?: string; payload?: Record<string, any> } = {}
  ) => {
    setActing(true);
    try {
      const requestId = generateRequestId();
      const { data, error } = await supabase.functions.invoke('db-cleanup-action', {
        body: { action, table, recordIds, requestId, ...extra },
      });
      if (error) throw error;
      if (data && (data as any).error) throw new Error((data as any).error);
      toast({
        title: 'Done',
        description: (data as any)?.idempotent
          ? `${action} already applied (idempotent)`
          : `${action} succeeded`,
      });
      return data;
    } catch (e: any) {
      toast({ title: `${action} failed`, description: await extractInvokeError(e), variant: 'destructive' });
      throw e;
    } finally {
      setActing(false);
    }
  }, []);

  // ----- Findings list mutation --------------------------------------------
  const removeFindings = useCallback((ids: string[]) => {
    setReport((prev) => {
      if (!prev) return prev;
      const idSet = new Set(ids);
      let next = prev.findings.filter((f) => !idSet.has(f.id));
      // #2: drop overflow aggregate rows whose underlying bucket is now empty.
      const realByBucket = new Map<string, number>();
      for (const f of next) {
        if (f.aggregate) continue;
        const k = `${f.module}::${f.rule}`;
        realByBucket.set(k, (realByBucket.get(k) || 0) + 1);
      }
      next = next.filter((f) => {
        if (!f.aggregate) return true;
        return (realByBucket.get(`${f.module}::${f.rule}`) || 0) > 0;
      });
      // #3: totals exclude aggregate rows.
      const totals: Record<string, number> = {};
      for (const m of prev.modules ?? []) totals[m] = 0;
      for (const f of next) {
        if (f.aggregate) continue;
        totals[f.module] = (totals[f.module] || 0) + 1;
      }
      const realTotal = next.filter((f) => !f.aggregate).length;
      return { ...prev, findings: next, total: realTotal, totals };
    });
  }, []);

  return {
    report, loading, acting,
    runScan, performAction,
    dismissFinding, undismissFinding, dismissed, removeFindings,
  };
}
