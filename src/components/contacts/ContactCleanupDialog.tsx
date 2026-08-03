import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCRUDAudit } from "@/hooks/useCRUDAudit";
import {
  analyzeContacts, type CleanupContact, type AnalyzeContactsResult, type ContactIssueKey,
  type DuplicateGroup, SEVERITY_MAP, suggestSurvivor,
} from "@/lib/contactCleanup";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import {
  preloadContactLinks, loadAccountUniverse,
  runWithConcurrency, type ContactLinkCounts,
} from "@/lib/contactLinks";
import { Trash2, GitMerge, Pencil, Download, RefreshCcw, Sparkles, PanelLeftClose, PanelLeftOpen, Search, Undo2, UserCog } from "lucide-react";
import { MergeContactsDialog } from "./MergeContactsDialog";
import { AppLoader } from "@/components/ui/loader";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void;
  onEditContact?: (id: string) => void;
}

type RowAction = "keep" | "merge" | "ignore";
type Assignment = { action: RowAction; targetId?: string };

const CATEGORIES: { key: ContactIssueKey; label: string; hint: string }[] = [
  { key: "exact_dup_email", label: "Duplicate email", hint: "Same normalized email (case + gmail dots)" },
  { key: "exact_dup_phone", label: "Duplicate phone", hint: "Same last-10 digits" },
  { key: "exact_dup_name_company", label: "Duplicate name + company", hint: "Same person at the same company" },
  { key: "fuzzy_dup_name_company", label: "Fuzzy name + company", hint: "Near-match name at same company" },
  { key: "cross_account_dup", label: "Cross-account duplicate", hint: "Same person on multiple accounts" },
  { key: "orphan_account", label: "Orphan account link", hint: "account_id points to a deleted account" },
  { key: "no_account", label: "No account", hint: "Neither account_id nor company_name set" },
  { key: "unlinked", label: "Unlinked", hint: "No deals & no campaign membership" },
  { key: "thin", label: "Thin records", hint: "Only a name — nothing else filled" },
  { key: "placeholder", label: "Placeholder / test", hint: "'test', 'N/A', empty, etc." },
  { key: "malformed_email", label: "Malformed email", hint: "Not a valid email format" },
  { key: "malformed_phone", label: "Malformed phone", hint: "Too few digits" },
  { key: "stale", label: "Stale", hint: "No activity in 12+ months and unlinked" },
];


const CONTACT_COLS = "*";

async function fetchAllContacts(onProgress?: (p: number, t: number) => void): Promise<CleanupContact[]> {
  const pageSize = 1000;
  let from = 0;
  const out: CleanupContact[] = [];
  // count is only used as a UI hint — the loop terminates on a short page,
  // not on `out.length >= total`, so mid-scan inserts don't cause early exit.
  const first = await supabase.from("contacts").select(CONTACT_COLS, { count: "exact" }).range(from, from + pageSize - 1);
  if (first.error) throw first.error;
  let totalHint = first.count ?? first.data?.length ?? 0;
  let lastPageSize = first.data?.length ?? 0;
  if (first.data) out.push(...(first.data as unknown as CleanupContact[]));
  onProgress?.(out.length, totalHint);
  while (lastPageSize === pageSize) {
    from += pageSize;
    const res = await supabase.from("contacts").select(CONTACT_COLS).range(from, from + pageSize - 1);
    if (res.error) throw res.error;
    lastPageSize = res.data?.length ?? 0;
    if (!lastPageSize) break;
    out.push(...(res.data as unknown as CleanupContact[]));
    totalHint = Math.max(totalHint, out.length);
    onProgress?.(out.length, totalHint);
  }
  return out;
}


const SeverityBadge = ({ sev }: { sev: "high" | "medium" | "low" }) => {
  const map = {
    high: "bg-destructive/10 text-destructive border-destructive/30",
    medium: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
    low: "bg-muted text-muted-foreground border-border",
  } as const;
  return <span className={`text-[10px] uppercase font-medium px-1.5 py-0.5 rounded border ${map[sev]}`}>{sev}</span>;
};

export const ContactCleanupDialog = ({ open, onOpenChange, onChanged, onEditContact }: Props) => {
  const { toast } = useToast();
  const { logBulkDelete } = useCRUDAudit();

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number }>({ loaded: 0, total: 0 });
  const [contacts, setContacts] = useState<CleanupContact[]>([]);
  const ownerIds = useMemo(
    () => Array.from(new Set(contacts.map((c) => c.contact_owner).filter((v): v is string => !!v))),
    [contacts]
  );
  const { displayNames: ownerNames } = useUserDisplayNames(ownerIds);
  const displayOwner = (id?: string | null) => (id ? (ownerNames[id] || "…") : "—");
  const [linkCounts, setLinkCounts] = useState<Record<string, ContactLinkCounts>>({});
  const [result, setResult] = useState<AnalyzeContactsResult | null>(null);
  const [activeCat, setActiveCat] = useState<ContactIssueKey>("exact_dup_email");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mergeIds, setMergeIds] = useState<string[] | null>(null);
  const [assignmentsByGroup, setAssignmentsByGroup] = useState<Record<string, Record<string, Assignment>>>({});
  const [mergingGroup, setMergingGroup] = useState<string | null>(null);
  const [mergedGroups, setMergedGroups] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [confirmBulk, setConfirmBulk] = useState(false);
  const cancelRef = useRef(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [dryRun, setDryRun] = useState(false);
  const [assignOwnerOpen, setAssignOwnerOpen] = useState(false);
  const [ownerValue, setOwnerValue] = useState("");
  const [undoBuffer, setUndoBuffer] = useState<{ contacts: CleanupContact[]; expiresAt: number } | null>(null);

  const contactsById = useMemo(() => {
    const m = new Map<string, CleanupContact>();
    for (const c of contacts) m.set(c.id, c);
    return m;
  }, [contacts]);

  // Load persisted dismissals from cleanup_dismissals so re-scans don't
  // re-surface findings the user already ignored.
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("cleanup_dismissals").select("finding_id, rule").eq("module", "contacts");
      if (data) setDismissed(new Set((data as any[]).map((d) => d.finding_id)));
    })();
  }, [open]);

  const persistDismissal = async (ids: string[], rule: ContactIssueKey) => {
    const { data: user } = await supabase.auth.getUser();
    if (!user?.user?.id) return;
    // Upsert against the (module, rule, finding_id, user_id) unique index —
    // avoids duplicate-key errors when the same finding is dismissed twice.
    await supabase.from("cleanup_dismissals").upsert(
      ids.map((id) => ({ module: "contacts", rule, finding_id: id, user_id: user.user!.id })),
      { onConflict: "module,rule,finding_id,user_id", ignoreDuplicates: true },
    );
  };

  const runScan = useCallback(async () => {
    setScanning(true);
    setSelected(new Set());
    setResult(null);
    try {
      const all = await fetchAllContacts((loaded, total) => setProgress({ loaded, total }));
      setContacts(all);
      const [linkBundle, accountU] = await Promise.all([
        preloadContactLinks(all.map((c) => ({ id: c.id, contact_name: c.contact_name, company_name: c.company_name, account_id: c.account_id }))),
        loadAccountUniverse(),
      ]);
      setLinkCounts(linkBundle.counts);
      setResult(analyzeContacts({
        contacts: all,
        dealCounts: linkBundle.dealCounts,
        campaignCounts: linkBundle.campaignCounts,
        validAccountIds: accountU.validAccountIds,
        accountNameById: accountU.accountNameById,
      }));
    } catch (e: any) {
      console.error("[contact cleanup scan]", e);
      const parts = [e?.message, e?.code ? `(${e.code})` : null, e?.hint].filter(Boolean);
      toast({ title: "Scan failed", description: parts.join(" ") || "Unknown error", variant: "destructive" });
    } finally {
      setScanning(false);
    }
  }, [toast]);

  const totalLinkCount = (id: string) => {
    const c = linkCounts[id];
    return c ? c.deals + c.campaignContacts + c.campaignCommunications + c.variantAssignments : 0;
  };

  const searchMatches = useCallback((c: CleanupContact) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      (c.contact_name || "").toLowerCase().includes(q) ||
      (c.email || "").toLowerCase().includes(q) ||
      (c.company_name || "").toLowerCase().includes(q) ||
      (c.phone_no || "").toLowerCase().includes(q)
    );
  }, [search]);

  const rowsForCategory = useMemo(() => {
    if (!result) return [];
    return contacts
      .filter((c) => !dismissed.has(c.id))
      .filter((c) => (result.issuesByContact[c.id] || []).includes(activeCat))
      .filter((c) => severityFilter === "all" || result.severityByContact[c.id] === severityFilter)
      .filter(searchMatches);
  }, [result, contacts, dismissed, activeCat, severityFilter, searchMatches]);

  const groupsForCategory = useMemo((): DuplicateGroup[] | null => {
    if (!result) return null;
    switch (activeCat) {
      case "exact_dup_email": return result.emailGroups;
      case "exact_dup_phone": return result.phoneGroups;
      case "exact_dup_name_company": return result.nameCompanyGroups;
      case "fuzzy_dup_name_company": return result.fuzzyNameCompanyGroups;
      case "cross_account_dup": return result.crossAccountGroups;
      default: return null;
    }
  }, [result, activeCat]);

  // Auto-assign a suggested survivor per group (richest record) — user can change.
  useEffect(() => {
    if (!groupsForCategory) return;
    setAssignmentsByGroup((prev) => {
      const next = { ...prev };
      for (const g of groupsForCategory) {
        if (next[g.key]) continue;
        const members = g.contactIds.map((id) => contactsById.get(id)).filter(Boolean) as CleanupContact[];
        const suggested = suggestSurvivor(members, totalLinkCount);
        const map: Record<string, Assignment> = {};
        for (const id of g.contactIds) {
          if (id === suggested?.id) map[id] = { action: "keep" };
          else map[id] = { action: "merge", targetId: suggested?.id };
        }
        next[g.key] = map;
      }
      return next;
    });
  }, [groupsForCategory, contactsById, linkCounts]);

  const setAssign = (groupKey: string, rowId: string, action: RowAction) => {
    setAssignmentsByGroup((prev) => {
      const gm = { ...(prev[groupKey] || {}) };
      gm[rowId] = { action };
      if (action !== "keep") {
        for (const k of Object.keys(gm)) {
          if (gm[k].action === "merge" && gm[k].targetId === rowId) gm[k] = { action: "merge", targetId: undefined };
        }
      }
      return { ...prev, [groupKey]: gm };
    });
  };
  const setTarget = (groupKey: string, rowId: string, targetId: string) => {
    setAssignmentsByGroup((prev) => ({ ...prev, [groupKey]: { ...(prev[groupKey] || {}), [rowId]: { action: "merge", targetId } } }));
  };

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

  const groupStatus = (groupKey: string, visibleIds: string[]) => {
    const map = assignmentsByGroup[groupKey] || {};
    let kept = 0, merged = 0, ignored = 0, unresolved = 0;
    const keptIds = new Set(visibleIds.filter((id) => map[id]?.action === "keep"));
    for (const id of visibleIds) {
      const a = map[id];
      if (!a || a.action === "ignore") { ignored++; continue; }
      if (a.action === "keep") { kept++; continue; }
      if (a.action === "merge") {
        if (a.targetId && keptIds.has(a.targetId)) merged++; else unresolved++;
      }
    }
    return { kept, merged, ignored, unresolved };
  };

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectAllVisible = () => setSelected(new Set(rowsForCategory.map((r) => r.id)));
  const clearSelection = () => setSelected(new Set());

  // ---------- Undo (60s in-memory restore of last delete) ----------
  const scheduleUndo = (deletedContacts: CleanupContact[]) => {
    setUndoBuffer({ contacts: deletedContacts, expiresAt: Date.now() + 60_000 });
  };
  useEffect(() => {
    if (!undoBuffer) return;
    const t = setTimeout(() => setUndoBuffer(null), Math.max(0, undoBuffer.expiresAt - Date.now()));
    return () => clearTimeout(t);
  }, [undoBuffer]);
  const performUndo = async () => {
    if (!undoBuffer) return;
    try {
      // Restore the full snapshot row-for-row so industry / linkedin /
      // description / region / source / created_time survive the round-trip.
      // We drop generated columns that PostgREST won't accept on insert.
      const rows = undoBuffer.contacts.map((c) => {
        const row: Record<string, any> = { ...(c as any) };
        delete row.modified_time;
        if (!row.contact_name) row.contact_name = "Restored contact";
        return row;
      });
      const { error } = await supabase.from("contacts").insert(rows as any);
      if (error) throw error;
      toast({ title: "Restored", description: `${rows.length} contact${rows.length !== 1 ? "s" : ""} restored (links are NOT restored).` });
      setUndoBuffer(null);
      onChanged?.();
      await runScan();
    } catch (e: any) {
      toast({ title: "Undo failed", description: e?.message || "Unknown", variant: "destructive" });
    }
  };


  const performBulkDelete = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (dryRun) {
      toast({ title: "Dry run", description: `Would delete ${ids.length} contact(s).` });
      setConfirmDelete(false);
      return;
    }
    try {
      const snapshot = ids.map((id) => contactsById.get(id)).filter(Boolean) as CleanupContact[];
      const { error } = await supabase.from("contacts").delete().in("id", ids);
      if (error) throw error;
      await logBulkDelete("contacts", ids.length, ids);
      scheduleUndo(snapshot);
      toast({ title: "Deleted", description: `${ids.length} contact${ids.length !== 1 ? "s" : ""} removed. Undo available for 60s.` });
      setSelected(new Set());
      setConfirmDelete(false);
      onChanged?.();
      await runScan();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message || "Unknown", variant: "destructive" });
    }
  };

  const dismissSelected = async () => {
    const ids = [...selected];
    setDismissed((prev) => { const n = new Set(prev); ids.forEach((id) => n.add(id)); return n; });
    setSelected(new Set());
    try { await persistDismissal(ids, activeCat); } catch { /* non-fatal */ }
  };

  const assignOwnerToSelected = async () => {
    const ids = [...selected];
    if (!ids.length || !ownerValue.trim()) return;
    try {
      const { error } = await supabase.from("contacts").update({ contact_owner: ownerValue.trim() }).in("id", ids);
      if (error) throw error;
      toast({ title: "Owner assigned", description: `${ids.length} contact${ids.length !== 1 ? "s" : ""} → ${ownerValue}` });
      setAssignOwnerOpen(false);
      setOwnerValue("");
      setSelected(new Set());
      onChanged?.();
      await runScan();
    } catch (e: any) {
      toast({ title: "Assign failed", description: e?.message || "Unknown", variant: "destructive" });
    }
  };

  const exportCSV = () => {
    const rows = [
      ["id", "name", "email", "phone", "company", "account_id", "owner", "deals", "campaigns", "severity", "issues"],
      ...rowsForCategory.map((c) => [
        c.id, c.contact_name || "", c.email || "", c.phone_no || "",
        c.company_name || "", c.account_id || "", displayOwner(c.contact_owner),
        String(linkCounts[c.id]?.deals ?? 0),
        String(linkCounts[c.id]?.campaignContacts ?? 0),
        result?.severityByContact[c.id] || "",
        (result?.issuesByContact[c.id] || []).join("|"),
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contacts-cleanup-${activeCat}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const catCount = (k: ContactIssueKey) => result?.counts[k] ?? 0;

  const BACKFILL_FIELDS: Array<keyof CleanupContact> = [
    "email", "phone_no", "position", "company_name", "account_id", "contact_owner",
  ];
  const isEmpty = (v: any) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  const computeBackfillPatch = (survivor: CleanupContact, losers: CleanupContact[]) => {
    const patch: Record<string, any> = {};
    for (const f of BACKFILL_FIELDS) {
      if (!isEmpty((survivor as any)[f])) continue;
      for (const l of losers) {
        const v = (l as any)[f];
        if (!isEmpty(v)) { patch[f as string] = typeof v === "string" ? v.trim() : v; break; }
      }
    }
    // last_activity_time: take max across survivor+losers
    const times = [survivor, ...losers]
      .map((c) => c.last_activity_time ? new Date(c.last_activity_time).getTime() : 0)
      .filter((t) => Number.isFinite(t) && t > 0);
    if (times.length) {
      const max = new Date(Math.max(...times)).toISOString();
      const cur = survivor.last_activity_time ? new Date(survivor.last_activity_time).toISOString() : null;
      if (max !== cur) patch.last_activity_time = max;
    }
    return patch;
  };

  const mergeOneGroup = async (groupKey: string) => {
    const plan = buildGroupPlan(groupKey);
    if (plan.length === 0) return { losers: 0, kept: 0, pairs: 0, backfilled: [] as string[] };
    let deleted = 0;
    const backfilledFields = new Set<string>();
    for (const { survivorId, loserIds } of plan) {
      const survivor = contactsById.get(survivorId);
      if (!survivor) throw new Error("Survivor not found");
      const losers = loserIds.map((id) => contactsById.get(id)).filter((a): a is CleanupContact => !!a && !dismissed.has(a.id));
      if (!losers.length) continue;
      const patch = computeBackfillPatch(survivor, losers);
      Object.keys(patch).forEach((k) => backfilledFields.add(k));
      if (dryRun) { deleted += losers.length; continue; }
      // Atomic merge via RPC — repoints all incoming links + deletes losers in one txn.
      const ids = losers.map((l) => l.id);
      const { error } = await supabase.rpc('merge_contacts_cascade', {
        p_survivor_id: survivorId,
        p_loser_ids: ids,
        p_patch: patch,
      });
      if (error) throw error;
      await logBulkDelete("contacts", ids.length, ids);
      scheduleUndo(losers);
      deleted += ids.length;
    }
    const map = assignmentsByGroup[groupKey] || {};
    const kept = Object.values(map).filter((a) => a.action === "keep").length;
    return { losers: deleted, kept, pairs: plan.length, backfilled: Array.from(backfilledFields) };
  };



  const mergeSingleGroup = async (groupKey: string, visibleIds: string[]) => {
    const status = groupStatus(groupKey, visibleIds);
    if (status.merged === 0 || status.kept === 0 || status.unresolved > 0) {
      toast({ title: "Nothing to merge", description: "Assign at least one Keep and one Merge into…", variant: "destructive" });
      return;
    }
    setMergingGroup(groupKey);
    try {
      const { losers, kept, backfilled } = await mergeOneGroup(groupKey);
      setMergedGroups((prev) => new Set(prev).add(groupKey));
      const bf = backfilled.length ? ` · backfilled: ${backfilled.join(", ")}` : "";
      toast({ title: dryRun ? "Dry run" : "Merged", description: `${losers} merged · ${kept} kept · ${status.ignored} ignored${bf}` });
      onChanged?.();

    } catch (e: any) {
      console.error("[merge group]", e);
      toast({ title: "Merge failed", description: e?.message || "Unknown", variant: "destructive" });
    } finally {
      setMergingGroup(null);
    }
  };

  // ---------- Per-group bulk actions ----------
  const [confirmGroupDelete, setConfirmGroupDelete] = useState<{ groupKey: string; ids: string[] } | null>(null);

  const setGroupAllAction = (groupKey: string, visibleIds: string[], action: RowAction) => {
    setAssignmentsByGroup((prev) => {
      const gm: Record<string, Assignment> = {};
      for (const id of visibleIds) gm[id] = { action };
      return { ...prev, [groupKey]: gm };
    });
  };

  const keepAllInGroup = (groupKey: string, visibleIds: string[]) => {
    setGroupAllAction(groupKey, visibleIds, "keep");
    toast({ title: "All kept", description: `${visibleIds.length} contact${visibleIds.length !== 1 ? "s" : ""} marked keep. Nothing will be merged.` });
  };

  const dismissAllInGroup = async (groupKey: string, visibleIds: string[]) => {
    setDismissed((prev) => { const n = new Set(prev); visibleIds.forEach((id) => n.add(id)); return n; });
    try { await persistDismissal(visibleIds, activeCat); } catch { /* non-fatal */ }
    toast({ title: "Group dismissed", description: `${visibleIds.length} contact${visibleIds.length !== 1 ? "s" : ""} ignored.` });
  };

  const deleteAllInGroup = async (groupKey: string, ids: string[]) => {
    if (!ids.length) return;
    if (dryRun) {
      toast({ title: "Dry run", description: `Would delete ${ids.length} contact(s) in group.` });
      setConfirmGroupDelete(null);
      return;
    }
    try {
      const snapshot = ids.map((id) => contactsById.get(id)).filter(Boolean) as CleanupContact[];
      const { error } = await supabase.from("contacts").delete().in("id", ids);
      if (error) throw error;
      await logBulkDelete("contacts", ids.length, ids);
      scheduleUndo(snapshot);
      setMergedGroups((prev) => new Set(prev).add(groupKey));
      toast({ title: "Deleted", description: `${ids.length} contact${ids.length !== 1 ? "s" : ""} removed from group. Undo available for 60s.` });
      setConfirmGroupDelete(null);
      onChanged?.();
      await runScan();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message || "Unknown", variant: "destructive" });
    }
  };

  const eligibleGroups = useMemo(() => {
    if (!groupsForCategory) return [];
    return groupsForCategory.filter((g) => {
      if (mergedGroups.has(g.key)) return false;
      const visible = g.contactIds.filter((id) => !dismissed.has(id));
      const s = groupStatus(g.key, visible);
      return s.merged > 0 && s.kept > 0 && s.unresolved === 0;
    });
  }, [groupsForCategory, mergedGroups, dismissed, assignmentsByGroup]);

  const bulkImpact = useMemo(() => {
    let deletes = 0, linksMoved = 0;
    for (const g of eligibleGroups) {
      const plan = buildGroupPlan(g.key);
      for (const p of plan) {
        deletes += p.loserIds.length;
        for (const l of p.loserIds) linksMoved += totalLinkCount(l);
      }
    }
    return { groups: eligibleGroups.length, deletes, linksMoved };
  }, [eligibleGroups, assignmentsByGroup, linkCounts]);

  const runBulkMerge = async () => {
    setBulkRunning(true);
    cancelRef.current = false;
    setBulkProgress({ done: 0, total: eligibleGroups.length });
    let ok = 0, failed = 0, totalLosers = 0;
    try {
      await runWithConcurrency(eligibleGroups, 5, async (g) => {
        if (cancelRef.current) return;
        try {
          const { losers } = await mergeOneGroup(g.key);
          setMergedGroups((prev) => new Set(prev).add(g.key));
          totalLosers += losers; ok++;
        } catch (e) {
          console.error("[bulk-merge]", g.key, e); failed++;
        }
      }, (done, total) => setBulkProgress({ done, total }));
      toast({
        title: dryRun ? "Dry run complete" : "Bulk merge complete",
        description: `${ok} group${ok !== 1 ? "s" : ""} · ${totalLosers} record${totalLosers !== 1 ? "s" : ""} removed${failed ? ` · ${failed} failed` : ""}${cancelRef.current ? " (cancelled)" : ""}`,
      });
      setConfirmBulk(false);
      onChanged?.();
      if (!dryRun) await runScan();
    } finally {
      setBulkRunning(false);
      cancelRef.current = false;
    }
  };

  // Keyboard shortcuts inside the dialog: A=select all, X=clear, D=delete, M=bulk merge, /=focus search
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "a") { e.preventDefault(); selectAllVisible(); }
      else if (e.key === "x") { e.preventDefault(); clearSelection(); }
      else if (e.key === "d" && selected.size) { e.preventDefault(); setConfirmDelete(true); }
      else if (e.key === "m" && eligibleGroups.length) { e.preventDefault(); setConfirmBulk(true); }
      else if (e.key === "/") { e.preventDefault(); document.getElementById("cleanup-search-input")?.focus(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, selected.size, eligibleGroups.length, rowsForCategory]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[98vw] w-[98vw] h-[92vh] p-0 flex flex-col sm:max-w-[98vw]">
          <DialogHeader className="px-6 pt-6 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Contacts Cleanup & Diagnostics
            </DialogTitle>
            <DialogDescription>
              Scan every contact against 14 rules — duplicates, orphans, malformed, placeholder, stale. Merge repoints deal_stakeholders, campaign_contacts, communications, and A/B assignments before deletion. Shortcuts: <kbd>A</kbd> select · <kbd>X</kbd> clear · <kbd>D</kbd> delete · <kbd>M</kbd> merge all · <kbd>/</kbd> search.
            </DialogDescription>
          </DialogHeader>

          {!result ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
              {scanning ? (
                <div className="w-full max-w-md space-y-3 text-center">
                  <AppLoader variant="inline" className="mx-auto" />
                  <div className="text-sm text-muted-foreground">
                    Scanning contacts… {progress.loaded}{progress.total ? ` / ${progress.total}` : ""}
                  </div>
                  {progress.total > 0 && <Progress value={(progress.loaded / progress.total) * 100} />}
                </div>
              ) : (
                <>
                  <p className="text-muted-foreground text-center max-w-md">
                    The scan reads every contact plus their deal/campaign links and checks against 14 quality rules. May take a few seconds on large workspaces.
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
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setSidebarCollapsed(false)} title="Expand">
                    <PanelLeftOpen className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="w-72 border-r bg-muted/30 flex-shrink-0">
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
                        const sev = SEVERITY_MAP[c.key];
                        return (
                          <button
                            key={c.key}
                            onClick={() => { setActiveCat(c.key); setSelected(new Set()); }}
                            className={`w-full text-left rounded-md px-3 py-2 text-sm flex items-center justify-between gap-2 ${isActive ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                          >
                            <div className="flex flex-col min-w-0">
                              <span className="font-medium flex items-center gap-1.5">
                                <SeverityBadge sev={sev} />
                                <span className="truncate">{c.label}</span>
                              </span>
                              <span className="text-[11px] text-muted-foreground truncate">{c.hint}</span>
                            </div>
                            <Badge variant={n > 0 ? "secondary" : "outline"}>{n}</Badge>
                          </button>
                        );
                      })}
                      <div className="pt-4 px-2 text-xs text-muted-foreground">
                        Scanned {contacts.length} contact{contacts.length !== 1 ? "s" : ""}.
                        <div className="mt-1">Dismissed: {dismissed.size}</div>
                      </div>
                    </div>
                  </ScrollArea>
                </div>
              )}

              <div className="flex-1 min-w-0 flex flex-col">
                <div className="px-4 py-2 border-b flex items-center gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      id="cleanup-search-input"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search name/email/phone…"
                      className="h-8 pl-7 w-56 text-xs"
                    />
                  </div>
                  <Select value={severityFilter} onValueChange={(v: any) => setSeverityFilter(v)}>
                    <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All severities</SelectItem>
                      <SelectItem value="high">High only</SelectItem>
                      <SelectItem value="medium">Medium only</SelectItem>
                      <SelectItem value="low">Low only</SelectItem>
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-1.5 text-xs">
                    <Checkbox checked={dryRun} onCheckedChange={(v) => setDryRun(!!v)} />
                    Dry run
                  </label>
                  <Button size="sm" variant="outline" onClick={selectAllVisible} disabled={!rowsForCategory.length}>
                    Select all ({rowsForCategory.length})
                  </Button>
                  <Button size="sm" variant="outline" onClick={clearSelection} disabled={!selected.size}>Clear</Button>

                  {eligibleGroups.length > 0 && (
                    <Button size="sm" className="gap-1" onClick={() => setConfirmBulk(true)} disabled={bulkRunning}
                      title={`Delete ${bulkImpact.deletes} · move ${bulkImpact.linksMoved} links`}>
                      <GitMerge className="h-4 w-4" /> Merge all {eligibleGroups.length}
                    </Button>
                  )}
                  <Button size="sm" variant="destructive" className="gap-1"
                    disabled={!selected.size} onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="h-4 w-4" /> Delete ({selected.size})
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1"
                    disabled={!selected.size} onClick={() => setAssignOwnerOpen(true)}>
                    <UserCog className="h-4 w-4" /> Assign owner
                  </Button>
                  <Button size="sm" variant="outline" onClick={dismissSelected} disabled={!selected.size}>Dismiss</Button>
                  <div className="flex-1" />
                  {undoBuffer && (
                    <Button size="sm" variant="outline" className="gap-1" onClick={performUndo}>
                      <Undo2 className="h-4 w-4" /> Undo {undoBuffer.contacts.length}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="gap-1" onClick={exportCSV} disabled={!rowsForCategory.length}>
                    <Download className="h-4 w-4" /> CSV
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
                  {!rowsForCategory.length ? (
                    <div className="p-8 text-center text-muted-foreground">Nothing flagged in this category.</div>
                  ) : groupsForCategory ? (
                    <div className="p-3 space-y-4">
                      {groupsForCategory
                        .filter((g) => g.contactIds.some((id) => !dismissed.has(id) && searchMatches(contactsById.get(id)!)))
                        .map((g) => {
                          const visible = g.contactIds
                            .map((id) => contactsById.get(id)!)
                            .filter(Boolean)
                            .filter((c) => !dismissed.has(c.id));
                          const visibleIds = visible.map((c) => c.id);
                          if (mergedGroups.has(g.key)) {
                            return (
                              <div key={g.key} className="border rounded-md px-3 py-2 text-xs text-muted-foreground bg-muted/20 flex items-center gap-2">
                                <GitMerge className="h-3 w-3" /> Merged — {g.reason.replace(/_/g, " ")} · {g.contactIds.length} contacts
                              </div>
                            );
                          }
                          const status = groupStatus(g.key, visibleIds);
                          const groupMap = assignmentsByGroup[g.key] || {};
                          const survivors = visible.filter((c) => groupMap[c.id]?.action === "keep");
                          const canMerge = status.kept >= 1 && status.merged >= 1 && status.unresolved === 0;
                          const isMerging = mergingGroup === g.key;
                          return (
                            <div key={g.key} className="border rounded-md">
                              <div className="px-3 py-2 border-b bg-muted/40 flex items-center justify-between gap-2 flex-wrap">
                                <div className="text-sm">
                                  <span className="font-medium">{g.reason.replace(/_/g, " ")} · {visible.length} contacts</span>
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    {status.kept} kept · {status.merged} merged · {status.ignored} ignored
                                    {status.unresolved > 0 && <span className="text-destructive"> · {status.unresolved} unassigned</span>}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button size="sm" variant="outline" className="gap-1" disabled={isMerging}>
                                        <MoreHorizontal className="h-4 w-4" /> Group actions
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-56">
                                      <DropdownMenuItem onClick={() => keepAllInGroup(g.key, visibleIds)}>
                                        Keep all ({visible.length})
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => dismissAllInGroup(g.key, visibleIds)}>
                                        Ignore / dismiss all
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onClick={() => setConfirmGroupDelete({ groupKey: g.key, ids: visibleIds })}
                                      >
                                        Delete all in group ({visible.length})
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                  <Button size="sm" variant="ghost" onClick={() => setMergeIds(visible.map((c) => c.id))} disabled={isMerging}>
                                    Advanced…
                                  </Button>
                                  <Button size="sm" className="gap-1" disabled={isMerging || !canMerge}
                                    onClick={() => mergeSingleGroup(g.key, visibleIds)}>
                                    {isMerging ? <AppLoader variant="inline" /> : <GitMerge className="h-4 w-4" />}
                                    Merge {status.merged}
                                  </Button>
                                </div>
                              </div>
                              <RowTable rows={visible} selected={selected} toggle={toggle} linkCounts={linkCounts}
                                onEdit={onEditContact} severityByContact={result.severityByContact}
                                displayOwner={displayOwner}
                                assignments={groupMap} survivors={survivors}
                                onAction={(id, a) => setAssign(g.key, id, a)}
                                onTarget={(id, t) => setTarget(g.key, id, t)} />
                            </div>
                          );
                        })}
                    </div>
                  ) : (
                    <div className="p-3">
                      <RowTable rows={rowsForCategory} selected={selected} toggle={toggle} linkCounts={linkCounts}
                        onEdit={onEditContact} severityByContact={result.severityByContact}
                        displayOwner={displayOwner} />
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Bulk delete confirm */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} contact{selected.size !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const ids = [...selected];
                const totalLinks = ids.reduce((s, id) => s + totalLinkCount(id), 0);
                return totalLinks
                  ? `⚠️ ${totalLinks} link(s) across selected contacts will be cascade-deleted or orphaned. Consider Merge instead.`
                  : "None of the selected contacts have links.";
              })()}
              {dryRun && <div className="mt-2 text-xs">Dry run — nothing will actually be deleted.</div>}
              <div className="text-xs mt-1">Undo restores contact rows only (not their links) for 60s.</div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={performBulkDelete}>{dryRun ? "Preview" : "Delete"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmGroupDelete} onOpenChange={(o) => { if (!o) setConfirmGroupDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete all {confirmGroupDelete?.ids.length ?? 0} contact{(confirmGroupDelete?.ids.length ?? 0) !== 1 ? "s" : ""} in this group?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes every contact in the group without merging. Deal and campaign links pointing at them will be orphaned. Undo is available for 60 seconds (contacts only — links are not restored).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmGroupDelete && deleteAllInGroup(confirmGroupDelete.groupKey, confirmGroupDelete.ids)}
            >
              {dryRun ? "Preview" : "Delete all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk merge confirm */}
      <AlertDialog open={confirmBulk} onOpenChange={(o) => { if (!o && !bulkRunning) setConfirmBulk(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bulk merge {eligibleGroups.length} group{eligibleGroups.length !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              {bulkImpact.deletes} contact{bulkImpact.deletes !== 1 ? "s" : ""} will be deleted after {bulkImpact.linksMoved} link{bulkImpact.linksMoved !== 1 ? "s" : ""} are repointed. Rows marked Ignore are untouched.
              {dryRun && <div className="mt-2 text-xs">Dry run — nothing will actually be written.</div>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkRunning}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runBulkMerge} disabled={bulkRunning}>
              {bulkRunning ? "Merging…" : dryRun ? "Preview" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Assign owner */}
      <AlertDialog open={assignOwnerOpen} onOpenChange={setAssignOwnerOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Assign owner to {selected.size} contact{selected.size !== 1 ? "s" : ""}</AlertDialogTitle>
            <AlertDialogDescription>
              Enter the owner name or id. This overwrites any existing contact_owner value.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={ownerValue} onChange={(e) => setOwnerValue(e.target.value)} placeholder="Owner" autoFocus />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={assignOwnerToSelected} disabled={!ownerValue.trim()}>Assign</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {mergeIds && mergeIds.length >= 2 && (
        <MergeContactsDialog
          open={!!mergeIds}
          onOpenChange={(o) => { if (!o) setMergeIds(null); }}
          contacts={mergeIds.map((id) => contactsById.get(id)!).filter(Boolean)}
          linkCounts={linkCounts}
          onMerged={async () => { setMergeIds(null); onChanged?.(); await runScan(); }}
        />
      )}
    </>
  );
};

// ---------------- Row table ----------------

interface RowTableProps {
  rows: CleanupContact[];
  selected: Set<string>;
  toggle: (id: string) => void;
  linkCounts: Record<string, ContactLinkCounts>;
  onEdit?: (id: string) => void;
  severityByContact: Record<string, "high" | "medium" | "low">;
  displayOwner: (id?: string | null) => string;
  assignments?: Record<string, Assignment>;
  survivors?: CleanupContact[];
  onAction?: (rowId: string, action: RowAction) => void;
  onTarget?: (rowId: string, targetId: string) => void;
}

const RowTable = ({
  rows, selected, toggle, linkCounts, onEdit, severityByContact, displayOwner,
  assignments, survivors, onAction, onTarget,
}: RowTableProps) => {
  const showAssign = !!assignments && !!onAction;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground border-b sticky top-0 bg-background">
        <tr>
          <th className="p-2 w-8"></th>
          {showAssign && <th className="p-2 w-[240px]">Action</th>}
          <th className="p-2 w-14">Severity</th>
          <th className="p-2">Name</th>
          <th className="p-2">Email</th>
          <th className="p-2">Phone</th>
          <th className="p-2">Company</th>
          <th className="p-2">Position</th>
          <th className="p-2">Owner</th>
          <th className="p-2 text-right">Deals</th>
          <th className="p-2 text-right">Camps</th>
          <th className="p-2 w-8"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const lc = linkCounts[c.id];
          const assign = assignments?.[c.id];
          const availableSurvivors = (survivors || []).filter((s) => s.id !== c.id);
          const badTarget = showAssign && assign?.action === "merge" && (!assign.targetId || !availableSurvivors.some((s) => s.id === assign.targetId));
          return (
            <tr key={c.id} className="border-b hover:bg-muted/40">
              <td className="p-2"><Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} /></td>
              {showAssign && (
                <td className="p-2">
                  <div className="flex items-center gap-1.5">
                    <Select value={assign?.action || "ignore"} onValueChange={(v: RowAction) => onAction!(c.id, v)}>
                      <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="keep">Keep</SelectItem>
                        <SelectItem value="merge">Merge into…</SelectItem>
                        <SelectItem value="ignore">Ignore</SelectItem>
                      </SelectContent>
                    </Select>
                    {assign?.action === "merge" && (
                      <Select value={assign.targetId ?? ""} onValueChange={(v) => onTarget?.(c.id, v)}>
                        <SelectTrigger className={`h-7 w-[130px] text-xs ${badTarget ? "border-destructive text-destructive" : ""}`}>
                          <SelectValue placeholder="Pick Keep…" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableSurvivors.length === 0 ? (
                            <div className="px-2 py-1.5 text-xs text-muted-foreground">Mark a row Keep first</div>
                          ) : availableSurvivors.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.contact_name || "(unnamed)"}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </td>
              )}
              <td className="p-2"><SeverityBadge sev={severityByContact[c.id] || "low"} /></td>
              <td className="p-2 font-medium">{c.contact_name || <span className="italic text-muted-foreground">(empty)</span>}</td>
              <td className="p-2 truncate max-w-[200px]">{c.email || "—"}</td>
              <td className="p-2">{c.phone_no || "—"}</td>
              <td className="p-2 truncate max-w-[180px]">{c.company_name || "—"}</td>
              <td className="p-2">{c.position || "—"}</td>
              <td className="p-2">{displayOwner(c.contact_owner)}</td>
              <td className="p-2 text-right">{lc?.deals ?? 0}</td>
              <td className="p-2 text-right">{lc?.campaignContacts ?? 0}</td>
              <td className="p-2">
                {onEdit && (
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(c.id)} title="Edit">
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

export default ContactCleanupDialog;
