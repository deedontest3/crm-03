import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCRUDAudit } from "@/hooks/useCRUDAudit";
import { preloadAccountLinks, type AccountLinkCounts } from "@/lib/accountLinks";
import type { LinkedAccountContact, LinkedDeal, LinkedCampaign, LinkedActionItem } from "@/lib/accountLinks";
import { repointAccountLinks, runWithConcurrency } from "@/lib/accountLinks";
import { isRpcMissingError } from "@/lib/isRpcMissingError";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  analyzeAccounts, type CleanupAccount, type AnalyzeResult, type IssueKey,
} from "@/lib/accountCleanup";
import { Trash2, GitMerge, Pencil, Download, RefreshCcw, Sparkles, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { MergeAccountsDialog } from "./MergeAccountsDialog";
import { AccountLinksDrilldown } from "./AccountLinksDrilldown";
import { BulkDeleteAccountsDialog } from "./BulkDeleteAccountsDialog";
import { AppLoader } from "@/components/ui/loader";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void;
  onEditAccount?: (id: string) => void;
}

type RowAction = "keep" | "merge" | "ignore";
type Assignment = { action: RowAction; targetId?: string };


const CATEGORIES: { key: IssueKey; label: string; hint: string }[] = [
  { key: "exact_dup", label: "Exact duplicates", hint: "Same normalized name (case + suffix insensitive)" },
  { key: "fuzzy_dup", label: "Fuzzy duplicates", hint: "Near-match name, same domain, or same phone" },
  { key: "unlinked", label: "Unlinked / orphaned", hint: "No contacts and no deals" },
  { key: "thin", label: "Thin records", hint: "Only a name — nothing else filled" },
  { key: "placeholder", label: "Placeholder / test", hint: "'test', 'demo', 'N/A', etc." },
  { key: "malformed", label: "Malformed data", hint: "Invalid website, phone, or name" },
  { key: "stale", label: "Stale", hint: "No updates in 12+ months and unlinked" },
  { key: "no_owner", label: "Owner missing", hint: "No account owner set" },
];

async function fetchAllAccounts(onProgress?: (p: number, t: number) => void): Promise<CleanupAccount[]> {
  const pageSize = 1000;
  let from = 0;
  const out: CleanupAccount[] = [];
  const first = await supabase
    .from("accounts")
    .select("id,account_name,phone,website,industry,country,description,account_owner,company_type,region,modified_time,created_time", { count: "exact" })
    .order("id", { ascending: true })
    .range(from, from + pageSize - 1);
  if (first.error) throw first.error;
  const total = first.count ?? first.data?.length ?? 0;
  if (first.data) out.push(...(first.data as CleanupAccount[]));
  onProgress?.(out.length, total);
  while (out.length < total) {
    from += pageSize;
    const res = await supabase
      .from("accounts")
      .select("id,account_name,phone,website,industry,country,description,account_owner,company_type,region,modified_time,created_time")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (res.error) throw res.error;
    if (!res.data?.length) break;
    out.push(...(res.data as CleanupAccount[]));
    onProgress?.(out.length, total);
  }
  return out;
}

export const AccountCleanupDialog = ({ open, onOpenChange, onChanged, onEditAccount }: Props) => {
  const { toast } = useToast();
  const { logBulkDelete } = useCRUDAudit();

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number }>({ loaded: 0, total: 0 });
  const [accounts, setAccounts] = useState<CleanupAccount[]>([]);
  const [linkCounts, setLinkCounts] = useState<Record<string, AccountLinkCounts>>({});
  const [contactsByAccount, setContactsByAccount] = useState<Record<string, LinkedAccountContact[]>>({});
  const [dealsByAccount, setDealsByAccount] = useState<Record<string, LinkedDeal[]>>({});
  const [campaignsByAccount, setCampaignsByAccount] = useState<Record<string, LinkedCampaign[]>>({});
  const [actionsByAccount, setActionsByAccount] = useState<Record<string, LinkedActionItem[]>>({});
  const [drilldown, setDrilldown] = useState<{ id: string; section: "contacts" | "deals" | "campaigns" | "actions" | null } | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [activeCat, setActiveCat] = useState<IssueKey>("exact_dup");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [safeDeleteIds, setSafeDeleteIds] = useState<string[] | null>(null);
  const [mergeIds, setMergeIds] = useState<string[] | null>(null);
  const [bulkMergeGroups, setBulkMergeGroups] = useState<string[][] | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [assignmentsByGroup, setAssignmentsByGroup] = useState<Record<string, Record<string, Assignment>>>({});
  const [mergingGroup, setMergingGroup] = useState<string | null>(null);
  const [mergedGroups, setMergedGroups] = useState<Set<string>>(new Set());
  const cancelRef = useRef(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Derived counts for backwards-compat call sites in this file.
  const contactCounts = useMemo(() => Object.fromEntries(Object.entries(linkCounts).map(([k, v]) => [k, v.contacts])), [linkCounts]);
  const dealCounts = useMemo(() => Object.fromEntries(Object.entries(linkCounts).map(([k, v]) => [k, v.deals])), [linkCounts]);
  const totalLinkCount = (id: string) => {
    const c = linkCounts[id];
    return c ? c.contacts + c.deals + c.campaigns + c.actionItems + (c.leads || 0) + (c.campaignContacts || 0) : 0;
  };

  const accountsById = useMemo(() => {
    const m = new Map<string, CleanupAccount>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  const runScan = useCallback(async () => {
    setScanning(true);
    setSelected(new Set());
    setDismissed(new Set());
    setResult(null);
    try {
      const all = await fetchAllAccounts((loaded, total) => setProgress({ loaded, total }));
      setAccounts(all);
      const targets = all.map((a) => ({ id: a.id, account_name: a.account_name || "" }));
      const bundle = await preloadAccountLinks(targets);
      setLinkCounts(bundle.counts);
      setContactsByAccount(bundle.contactsByAccount);
      setDealsByAccount(bundle.dealsByAccount);
      setCampaignsByAccount(bundle.campaignsByAccount);
      setActionsByAccount(bundle.actionsByAccount);
      const cc = Object.fromEntries(Object.entries(bundle.counts).map(([k, v]) => [k, v.contacts]));
      const dc = Object.fromEntries(Object.entries(bundle.counts).map(([k, v]) => [k, v.deals]));
      setResult(analyzeAccounts({ accounts: all, contactCounts: cc, dealCounts: dc }));
    } catch (e: any) {
      console.error("[cleanup scan]", e);
      const parts = [e?.message, e?.code ? `(${e.code})` : null, e?.hint].filter(Boolean);
      toast({ title: "Scan failed", description: parts.join(" ") || "Unknown error", variant: "destructive" });

    } finally {
      setScanning(false);
    }
  }, [toast]);

  const rowsForCategory = useMemo(() => {
    if (!result) return [];
    return accounts
      .filter((a) => !dismissed.has(a.id))
      .filter((a) => (result.issuesByAccount[a.id] || []).includes(activeCat));
  }, [result, accounts, dismissed, activeCat]);

  const groupsForCategory = useMemo(() => {
    if (!result) return null;
    if (activeCat === "exact_dup") return result.exactGroups;
    if (activeCat === "fuzzy_dup") return result.fuzzyGroups;
    return null;
  }, [result, activeCat]);

  // Default per-row assignments to Ignore. As a starting hint, mark the row
  // with the most links as Keep so the user has a candidate survivor to pick.
  useEffect(() => {
    if (!groupsForCategory) return;
    setAssignmentsByGroup((prev) => {
      const next = { ...prev };
      for (const g of groupsForCategory) {
        if (next[g.key]) continue;
        const map: Record<string, Assignment> = {};
        for (const id of g.accountIds) map[id] = { action: "ignore" };
        const sorted = [...g.accountIds].sort((a, b) => totalLinkCount(b) - totalLinkCount(a));
        if (sorted[0]) map[sorted[0]] = { action: "keep" };
        next[g.key] = map;
      }
      return next;
    });
  }, [groupsForCategory, linkCounts]);

  // Per-row assignment helpers.
  const setAssign = (groupKey: string, rowId: string, action: RowAction) => {
    setAssignmentsByGroup((prev) => {
      const groupMap = { ...(prev[groupKey] || {}) };
      groupMap[rowId] = { action };
      // If a Keep was demoted, clear any "merge into" pointing at it.
      if (action !== "keep") {
        for (const key of Object.keys(groupMap)) {
          if (groupMap[key].action === "merge" && groupMap[key].targetId === rowId) {
            groupMap[key] = { action: "merge", targetId: undefined };
          }
        }
      }
      return { ...prev, [groupKey]: groupMap };
    });
  };
  const setTarget = (groupKey: string, rowId: string, targetId: string) => {
    setAssignmentsByGroup((prev) => {
      const groupMap = { ...(prev[groupKey] || {}) };
      groupMap[rowId] = { action: "merge", targetId };
      return { ...prev, [groupKey]: groupMap };
    });
  };

  // Given a group, compute the { survivorId, loserIds } pairs to execute.
  const buildGroupPlan = (groupKey: string): Array<{ survivorId: string; loserIds: string[] }> => {
    const map = assignmentsByGroup[groupKey] || {};
    const survivorIds = new Set(Object.keys(map).filter((id) => map[id]?.action === "keep"));
    const bySurvivor = new Map<string, string[]>();
    for (const [rowId, a] of Object.entries(map)) {
      if (a?.action !== "merge" || !a.targetId || !survivorIds.has(a.targetId)) continue;
      const list = bySurvivor.get(a.targetId) || [];
      list.push(rowId);
      bySurvivor.set(a.targetId, list);
    }
    return Array.from(bySurvivor.entries()).map(([survivorId, loserIds]) => ({ survivorId, loserIds }));
  };

  // Per-group status counters used in the header/summary + validation.
  const groupStatus = (groupKey: string, visibleIds: string[]) => {
    const map = assignmentsByGroup[groupKey] || {};
    let kept = 0, merged = 0, ignored = 0, unresolved = 0;
    const keptIds = new Set(visibleIds.filter((id) => map[id]?.action === "keep"));
    for (const id of visibleIds) {
      const a = map[id];
      if (!a || a.action === "ignore") { ignored++; continue; }
      if (a.action === "keep") { kept++; continue; }
      if (a.action === "merge") {
        if (a.targetId && keptIds.has(a.targetId)) merged++;
        else unresolved++;
      }
    }
    return { kept, merged, ignored, unresolved };
  };


  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected(new Set(rowsForCategory.map((r) => r.id)));
  };

  const clearSelection = () => setSelected(new Set());

  // Delete is routed through the shared BulkDeleteAccountsDialog so the user
  // gets the same keep-or-delete choices for linked contacts/deals/leads/etc.
  // instead of a raw account delete that either orphans links or fails on FK.
  const openSafeDelete = () => {
    const ids = [...selected];
    if (!ids.length) return;
    setSafeDeleteIds(ids);
  };

  const dismissSelected = () => {
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const id of selected) next.add(id);
      return next;
    });
    setSelected(new Set());
  };

  const exportCSV = () => {
    const rows = [
      ["id", "account_name", "industry", "country", "phone", "website", "owner", "contacts", "deals", "campaigns", "action_items", "issues"],
      ...rowsForCategory.map((a) => [
        a.id, a.account_name || "", a.industry || "", a.country || "",
        a.phone || "", a.website || "", a.account_owner || "",
        String(linkCounts[a.id]?.contacts ?? 0),
        String(linkCounts[a.id]?.deals ?? 0),
        String(linkCounts[a.id]?.campaigns ?? 0),
        String(linkCounts[a.id]?.actionItems ?? 0),
        (result?.issuesByAccount[a.id] || []).join("|"),
      ]),
    ];
    // RFC-4180 CSV. Prefixed with a UTF-8 BOM so Excel opens non-ASCII names
    // in the correct encoding instead of mangling them to garbled characters.
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `accounts-cleanup-${activeCat}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const catCount = (k: IssueKey) => result?.counts[k] ?? 0;

  // Merge one group using the per-row assignments. For each { survivorId,
  // loserIds } pair in the plan we repoint each loser's incoming links to the
  // survivor via the atomic `merge_accounts` RPC. Rows marked Ignore are left
  // untouched.
  const mergeOneGroup = async (groupKey: string) => {
    const plan = buildGroupPlan(groupKey);
    if (plan.length === 0) return { losers: 0, kept: 0, pairs: 0 };
    let deleted = 0;
    for (const { survivorId, loserIds } of plan) {
      const survivor = accountsById.get(survivorId);
      if (!survivor) throw new Error("Survivor not found");
      const losers = loserIds
        .map((id) => accountsById.get(id))
        .filter((a): a is CleanupAccount => !!a && !dismissed.has(a.id));
      if (losers.length === 0) continue;
      const ids = losers.map((l) => l.id);
      // Atomic path: SECURITY DEFINER RPC repoints every link type and deletes
      // the losers in a single transaction. Fall back to the legacy per-step
      // path only if the function isn't installed on this project.
      const { data: rpcData, error: rpcErr } = await (supabase as any).rpc("merge_accounts", {
        p_survivor_id: survivor.id,
        p_loser_ids: ids,
        p_patch: {},
      });
      const rpcMissing = !!rpcErr && isRpcMissingError(rpcErr);
      if (rpcErr && !rpcMissing) throw rpcErr;
      if (rpcMissing) {
        await Promise.all(losers.map((l) =>
          repointAccountLinks({
            loserId: l.id,
            loserName: l.account_name || "",
            survivorId: survivor.id,
            survivorName: survivor.account_name || "",
          })
        ));
        const { error } = await supabase.from("accounts").delete().in("id", ids);
        if (error) throw error;
      }
      await logBulkDelete("accounts", ids.length, ids);
      deleted += ids.length;
      void rpcData;
    }
    const map = assignmentsByGroup[groupKey] || {};
    const kept = Object.values(map).filter((a) => a.action === "keep").length;
    return { losers: deleted, kept, pairs: plan.length };
  };

  const mergeSingleGroup = async (groupKey: string, groupIds: string[]) => {
    const visibleIds = groupIds.filter((id) => !dismissed.has(id));
    const status = groupStatus(groupKey, visibleIds);
    if (status.merged === 0 || status.kept === 0 || status.unresolved > 0) {
      toast({
        title: "Nothing to merge",
        description: "Assign at least one row to Keep and at least one to Merge into a Keep.",
        variant: "destructive",
      });
      return;
    }
    setMergingGroup(groupKey);
    try {
      const { losers, kept } = await mergeOneGroup(groupKey);
      // Also auto-dismiss rows the user marked "Ignore" in this group so they
      // don't linger in the list on rescan.
      const map = assignmentsByGroup[groupKey] || {};
      const ignoredIds = visibleIds.filter((id) => (map[id]?.action ?? "ignore") === "ignore");
      if (ignoredIds.length) {
        setDismissed((prev) => {
          const next = new Set(prev);
          for (const id of ignoredIds) next.add(id);
          return next;
        });
      }
      setMergedGroups((prev) => new Set(prev).add(groupKey));
      toast({
        title: "Merged",
        description: `${losers} merged · ${kept} kept · ${status.ignored} ignored`,
      });
      onChanged?.();
    } catch (e: any) {
      console.error("[merge group]", e);
      toast({ title: "Merge failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setMergingGroup(null);
    }
  };

  const startBulkMerge = () => {
    if (!groupsForCategory) return;
    const eligible = groupsForCategory
      .filter((g) => !mergedGroups.has(g.key))
      .filter((g) => {
        const visibleIds = g.accountIds.filter((id) => !dismissed.has(id));
        const s = groupStatus(g.key, visibleIds);
        return s.merged > 0 && s.kept > 0 && s.unresolved === 0;
      });
    if (eligible.length === 0) {
      toast({
        title: "No groups assigned",
        description: "In each group, mark a Keep and a Merge into… before running bulk merge.",
        variant: "destructive",
      });
      return;
    }
    setBulkMergeGroups(eligible.map((g) => [g.key] as any));
  };

  const runBulkMerge = async () => {
    if (!bulkMergeGroups) return;
    setBulkRunning(true);
    cancelRef.current = false;
    setBulkProgress({ done: 0, total: bulkMergeGroups.length });
    let ok = 0, failed = 0, totalLosers = 0;
    const failedKeys: string[] = [];
    try {
      await runWithConcurrency(
        bulkMergeGroups,
        5,
        async (entry) => {
          if (cancelRef.current) return;
          const [groupKey] = entry as any as string[];
          try {
            const { losers } = await mergeOneGroup(groupKey);
            setMergedGroups((prev) => new Set(prev).add(groupKey));
            totalLosers += losers;
            ok++;
          } catch (e) {
            console.error("[bulk-merge]", groupKey, e);
            failedKeys.push(groupKey);
            failed++;
          }
        },
        (done, total) => setBulkProgress({ done, total }),
      );
      toast({
        title: "Bulk merge complete",
        description: `${ok} group${ok !== 1 ? "s" : ""} merged · ${totalLosers} record${totalLosers !== 1 ? "s" : ""} removed${failed ? ` · ${failed} failed` : ""}${cancelRef.current ? " (cancelled)" : ""}`,
      });
      setBulkMergeGroups(null);
      onChanged?.();
      await runScan();
    } finally {
      setBulkRunning(false);
      cancelRef.current = false;
    }
  };

  // Live preview: total records to delete + total links to transfer, based on
  // the user's per-row assignments (not an auto-picked survivor).
  const bulkImpact = useMemo(() => {
    if (!groupsForCategory) return null;
    let groups = 0, deletes = 0, linksMoved = 0;
    for (const g of groupsForCategory) {
      if (mergedGroups.has(g.key)) continue;
      const visibleIds = g.accountIds.filter((id) => !dismissed.has(id));
      const s = groupStatus(g.key, visibleIds);
      if (s.merged === 0 || s.kept === 0 || s.unresolved > 0) continue;
      groups++;
      const plan = buildGroupPlan(g.key);
      for (const p of plan) {
        deletes += p.loserIds.length;
        for (const l of p.loserIds) linksMoved += totalLinkCount(l);
      }
    }
    return { groups, deletes, linksMoved };
  }, [groupsForCategory, mergedGroups, dismissed, assignmentsByGroup, linkCounts]);


  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[98vw] w-[98vw] h-[92vh] p-0 flex flex-col sm:max-w-[98vw]">
          <DialogHeader className="px-6 pt-6 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Accounts Cleanup & Diagnostics
            </DialogTitle>
            <DialogDescription>
              Scan every account for duplicates, orphans, thin, placeholder, malformed, stale, and owner-less records. Actions are permanent — merge or delete carefully.
            </DialogDescription>
          </DialogHeader>

          {!result ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
              {scanning ? (
                <div className="w-full max-w-md space-y-3 text-center">
                  <AppLoader variant="inline" className="mx-auto" />
                  <div className="text-sm text-muted-foreground">
                    Scanning accounts… {progress.loaded}{progress.total ? ` / ${progress.total}` : ""}
                  </div>
                  {progress.total > 0 && <Progress value={(progress.loaded / progress.total) * 100} />}
                </div>
              ) : (
                <>
                  <p className="text-muted-foreground text-center max-w-md">
                    The scan reads every account and checks it against 8 quality rules. It may take a few seconds on large workspaces.
                  </p>
                  <Button onClick={runScan} size="lg" className="gap-2">
                    <Sparkles className="h-4 w-4" /> Run scan
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex overflow-hidden">
              {sidebarCollapsed ? (
                <div className="w-10 border-r bg-muted/30 flex-shrink-0 flex flex-col items-center pt-3">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setSidebarCollapsed(false)} title="Expand categories">
                    <PanelLeftOpen className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
              <div className="w-64 border-r bg-muted/30 flex-shrink-0">
                <ScrollArea className="h-full">
                  <div className="p-3 space-y-1">
                    <div className="flex items-center justify-between px-2 py-1">
                      <span className="text-xs font-medium text-muted-foreground uppercase">Categories</span>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={runScan} title="Re-scan">
                          <RefreshCcw className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setSidebarCollapsed(true)} title="Collapse">
                          <PanelLeftClose className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    {CATEGORIES.map((c) => {
                      const isActive = activeCat === c.key;
                      const n = catCount(c.key);
                      return (
                        <button
                          key={c.key}
                          onClick={() => { setActiveCat(c.key); setSelected(new Set()); }}
                          className={`w-full text-left rounded-md px-3 py-2 text-sm flex items-center justify-between ${isActive ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                        >
                          <div className="flex flex-col">
                            <span className="font-medium">{c.label}</span>
                            <span className="text-[11px] text-muted-foreground">{c.hint}</span>
                          </div>
                          <Badge variant={n > 0 ? "secondary" : "outline"} className="ml-2">{n}</Badge>
                        </button>
                      );
                    })}
                    <div className="pt-4 px-2 text-xs text-muted-foreground">
                      Scanned {accounts.length} account{accounts.length !== 1 ? "s" : ""}.
                    </div>
                  </div>
                </ScrollArea>
              </div>
              )}

              {/* Content */}
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="px-4 py-2 border-b flex items-center gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={selectAllVisible} disabled={rowsForCategory.length === 0}>
                    Select all visible ({rowsForCategory.length})
                  </Button>
                  <Button size="sm" variant="outline" onClick={clearSelection} disabled={selected.size === 0}>
                    Clear
                  </Button>
                  {(activeCat === "exact_dup" || activeCat === "fuzzy_dup") && bulkImpact && bulkImpact.groups > 0 && (
                    <Button
                      size="sm"
                      className="gap-1"
                      disabled={bulkRunning}
                      onClick={startBulkMerge}
                      title={`Will delete ${bulkImpact.deletes} record(s) and transfer ${bulkImpact.linksMoved} link(s)`}
                    >
                      <GitMerge className="h-4 w-4" /> Merge all {bulkImpact.groups} groups
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    className="gap-1"
                    disabled={selected.size === 0}
                    onClick={openSafeDelete}
                  >
                    <Trash2 className="h-4 w-4" /> Delete ({selected.size})
                  </Button>
                  <Button size="sm" variant="outline" onClick={dismissSelected} disabled={selected.size === 0}>
                    Dismiss
                  </Button>
                  <div className="flex-1" />
                  {(activeCat === "exact_dup" || activeCat === "fuzzy_dup") && bulkImpact && bulkImpact.groups > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Impact: {bulkImpact.deletes} delete · {bulkImpact.linksMoved} links moved
                    </span>
                  )}
                  <Button size="sm" variant="ghost" className="gap-1" onClick={exportCSV} disabled={rowsForCategory.length === 0}>
                    <Download className="h-4 w-4" /> Export CSV
                  </Button>
                </div>
                {bulkRunning && (
                  <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-3">
                    <AppLoader variant="inline" />
                    <div className="flex-1">
                      <div className="text-xs mb-1">Merging {bulkProgress.done} / {bulkProgress.total} groups…</div>
                      <Progress value={bulkProgress.total ? (bulkProgress.done / bulkProgress.total) * 100 : 0} />
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => { cancelRef.current = true; }}>Cancel</Button>
                  </div>
                )}

                <ScrollArea className="flex-1">
                  {rowsForCategory.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">Nothing flagged in this category. </div>
                  ) : groupsForCategory ? (
                    <div className="p-3 space-y-4">
                      {groupsForCategory
                        .filter((g) => g.accountIds.some((id) => !dismissed.has(id)))
                        .map((g) => {
                          const visibleAccts = g.accountIds.map((id) => accountsById.get(id)!).filter(Boolean).filter((a) => !dismissed.has(a.id));
                          const visibleIds = visibleAccts.map((a) => a.id);
                          const isMerged = mergedGroups.has(g.key);
                          const isMerging = mergingGroup === g.key;
                          if (isMerged) {
                            return (
                              <div key={g.key} className="border rounded-md px-3 py-2 text-xs text-muted-foreground bg-muted/20 flex items-center gap-2">
                                <GitMerge className="h-3 w-3" /> Merged — {g.reason.replace("_", " ")} · {g.accountIds.length} accounts
                              </div>
                            );
                          }
                          const status = groupStatus(g.key, visibleIds);
                          const groupMap = assignmentsByGroup[g.key] || {};
                          const survivors = visibleAccts.filter((a) => groupMap[a.id]?.action === "keep");
                          const canMerge = status.kept >= 1 && status.merged >= 1 && status.unresolved === 0;
                          return (
                            <div key={g.key} className="border rounded-md">
                              <div className="px-3 py-2 border-b bg-muted/40 flex items-center justify-between gap-2 flex-wrap">
                                <div className="text-sm">
                                  <span className="font-medium">
                                    {g.reason.replace("_", " ")} · {visibleAccts.length} accounts
                                  </span>
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    {status.kept} kept · {status.merged} merged · {status.ignored} ignored
                                    {status.unresolved > 0 && (
                                      <span className="text-destructive"> · {status.unresolved} unassigned</span>
                                    )}
                                  </span>
                                  {status.kept === 0 && (
                                    <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                                      Pick one row's Action as <span className="font-medium">Keep</span> to enable the "Merge into…" dropdown on the others.
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setMergeIds(visibleAccts.map((a) => a.id))}
                                    disabled={isMerging}
                                    title="Advanced field-level merge"
                                  >
                                    Advanced…
                                  </Button>
                                  <Button
                                    size="sm"
                                    className="gap-1"
                                    disabled={isMerging || !canMerge}
                                    onClick={() => mergeSingleGroup(g.key, visibleIds)}
                                  >
                                    {isMerging ? <AppLoader variant="inline" /> : <GitMerge className="h-4 w-4" />}
                                    Merge {status.merged} record{status.merged === 1 ? "" : "s"}
                                  </Button>
                                </div>
                              </div>
                              <RowTable
                                rows={visibleAccts}
                                selected={selected}
                                toggle={toggle}
                                linkCounts={linkCounts}
                                onOpenLinks={(id, section) => setDrilldown({ id, section })}
                                malformedReasons={result.malformedReasons}
                                onEdit={onEditAccount}
                                assignments={groupMap}
                                survivors={survivors}
                                onAction={(id, a) => setAssign(g.key, id, a)}
                                onTarget={(id, t) => setTarget(g.key, id, t)}
                              />
                            </div>
                          );
                        })}

                    </div>
                  ) : (
                    <div className="p-3">
                      <RowTable
                        rows={rowsForCategory}
                        selected={selected}
                        toggle={toggle}
                        linkCounts={linkCounts}
                        onOpenLinks={(id, section) => setDrilldown({ id, section })}
                        malformedReasons={result.malformedReasons}
                        onEdit={onEditAccount}
                      />
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {safeDeleteIds && (
        <BulkDeleteAccountsDialog
          open={!!safeDeleteIds}
          onOpenChange={(o) => { if (!o) setSafeDeleteIds(null); }}
          accountIds={safeDeleteIds}
          onDeleted={async () => {
            const n = safeDeleteIds.length;
            setSafeDeleteIds(null);
            setSelected(new Set());
            toast({ title: "Deleted", description: `${n} account${n !== 1 ? "s" : ""} removed` });
            onChanged?.();
            await runScan();
          }}
        />
      )}

      <AlertDialog open={!!bulkMergeGroups} onOpenChange={(o) => { if (!o && !bulkRunning) setBulkMergeGroups(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bulk merge {bulkMergeGroups?.length ?? 0} group{(bulkMergeGroups?.length ?? 0) !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              {bulkMergeGroups && bulkImpact && (
                `Only groups where you've assigned Keep + Merge into will run. ${bulkImpact.deletes} record${bulkImpact.deletes !== 1 ? "s" : ""} will be deleted after their links are repointed. Rows marked Ignore are left alone.`
              )}

            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkRunning}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runBulkMerge} disabled={bulkRunning}>
              {bulkRunning ? "Merging…" : "Confirm bulk merge"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {mergeIds && mergeIds.length >= 2 && (
        <MergeAccountsDialog
          open={!!mergeIds}
          onOpenChange={(o) => { if (!o) setMergeIds(null); }}
          accounts={mergeIds.map((id) => accountsById.get(id)!).filter(Boolean)}
          linkCounts={linkCounts}
          onMerged={async () => {
            setMergeIds(null);
            onChanged?.();
            await runScan();
          }}
        />
      )}

      {drilldown && (
        <AccountLinksDrilldown
          open={!!drilldown}
          onOpenChange={(o) => { if (!o) setDrilldown(null); }}
          accountName={accountsById.get(drilldown.id)?.account_name || ""}
          section={drilldown.section}
          contacts={contactsByAccount[drilldown.id] || []}
          deals={dealsByAccount[drilldown.id] || []}
          campaigns={campaignsByAccount[drilldown.id] || []}
          actions={actionsByAccount[drilldown.id] || []}
        />
      )}
    </>
  );
};

interface RowTableProps {
  rows: CleanupAccount[];
  selected: Set<string>;
  toggle: (id: string) => void;
  linkCounts: Record<string, AccountLinkCounts>;
  onOpenLinks: (id: string, section: "contacts" | "deals" | "campaigns" | "actions" | null) => void;
  malformedReasons: Record<string, string[]>;
  onEdit?: (id: string) => void;
  assignments?: Record<string, Assignment>;
  survivors?: CleanupAccount[];
  onAction?: (rowId: string, action: RowAction) => void;
  onTarget?: (rowId: string, targetId: string) => void;
}

const LinkCell = ({ n, onClick }: { n: number; onClick: () => void }) => (
  n > 0 ? (
    <button
      onClick={onClick}
      className="text-primary hover:underline font-medium"
      title="View linked records"
    >{n}</button>
  ) : <span className="text-muted-foreground">0</span>
);

const RowTable = ({ rows, selected, toggle, linkCounts, onOpenLinks, malformedReasons, onEdit, assignments, survivors, onAction, onTarget }: RowTableProps) => {
  const showAssign = !!assignments && !!onAction;
  return (
  <table className="w-full text-sm">
    <thead className="text-left text-xs text-muted-foreground border-b sticky top-0 bg-background">
      <tr>
        <th className="p-2 w-8"></th>
        {showAssign && <th className="p-2 w-[240px]">Action</th>}
        <th className="p-2">Name</th>
        <th className="p-2">Industry</th>
        <th className="p-2">Country</th>
        <th className="p-2">Phone</th>
        <th className="p-2">Website</th>
        <th className="p-2 text-right">Contacts</th>
        <th className="p-2 text-right">Deals</th>
        <th className="p-2 text-right">Campaigns</th>
        <th className="p-2 text-right">Actions</th>
        <th className="p-2">Updated</th>
        <th className="p-2 w-8"></th>
      </tr>
    </thead>
    <tbody>
      {rows.map((a) => {
        const c = linkCounts[a.id];
        const assign = assignments?.[a.id];
        const availableSurvivors = (survivors || []).filter((s) => s.id !== a.id);
        const badTarget = showAssign && assign?.action === "merge" && (!assign.targetId || !availableSurvivors.some((s) => s.id === assign.targetId));
        return (
        <tr key={a.id} className="border-b hover:bg-muted/40">
          <td className="p-2"><Checkbox checked={selected.has(a.id)} onCheckedChange={() => toggle(a.id)} /></td>
          {showAssign && (
            <td className="p-2">
              <div className="flex items-center gap-1.5">
                <Select value={assign?.action || "ignore"} onValueChange={(v: RowAction) => onAction!(a.id, v)}>
                  <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">Keep</SelectItem>
                    <SelectItem value="merge">Merge into…</SelectItem>
                    <SelectItem value="ignore">Ignore</SelectItem>
                  </SelectContent>
                </Select>
                {assign?.action === "merge" && (
                  <Select value={assign.targetId ?? ""} onValueChange={(v) => onTarget?.(a.id, v)}>
                    <SelectTrigger className={`h-7 w-[130px] text-xs ${badTarget ? "border-destructive text-destructive" : ""}`}>
                      <SelectValue placeholder="Pick Keep…" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableSurvivors.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">Mark a row as Keep first</div>
                      ) : availableSurvivors.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.account_name || "(unnamed)"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </td>
          )}

          <td className="p-2 font-medium">
            <button onClick={() => onOpenLinks(a.id, null)} className="hover:underline text-left">
              {a.account_name || <span className="italic text-muted-foreground">(empty)</span>}
            </button>
            {malformedReasons[a.id]?.length ? (
              <div className="text-[11px] text-destructive">{malformedReasons[a.id].join(" · ")}</div>
            ) : null}
          </td>
          <td className="p-2">{a.industry || "—"}</td>
          <td className="p-2">{a.country || "—"}</td>
          <td className="p-2">{a.phone || "—"}</td>
          <td className="p-2 truncate max-w-[180px]">{a.website || "—"}</td>
          <td className="p-2 text-right"><LinkCell n={c?.contacts ?? 0} onClick={() => onOpenLinks(a.id, "contacts")} /></td>
          <td className="p-2 text-right"><LinkCell n={c?.deals ?? 0} onClick={() => onOpenLinks(a.id, "deals")} /></td>
          <td className="p-2 text-right"><LinkCell n={c?.campaigns ?? 0} onClick={() => onOpenLinks(a.id, "campaigns")} /></td>
          <td className="p-2 text-right"><LinkCell n={c?.actionItems ?? 0} onClick={() => onOpenLinks(a.id, "actions")} /></td>
          <td className="p-2 text-xs text-muted-foreground">{a.modified_time ? new Date(a.modified_time).toLocaleDateString() : "—"}</td>
          <td className="p-2">
            {onEdit && (
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(a.id)} title="Edit">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
          </td>
        </tr>
        );
      })}
    </tbody>
  </table>
  );
};


export default AccountCleanupDialog;