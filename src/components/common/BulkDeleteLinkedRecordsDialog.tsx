import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { AppLoader } from "@/components/ui/loader";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";

export type LinkAction = "keep" | "delete";
export type LinkedRecordActionsByItem = Record<string, Record<string, LinkAction>>;

export interface LinkTypeSpec {
  key: string;
  label: string;
  count: number;
  /** When false, the "Keep (unlink)" option is hidden and this type is always deleted. */
  keepable?: boolean;
  /** When true, no delete control is shown — the records are listed for reference only and never deleted. */
  informational?: boolean;
  /** Optional short helper text shown under the label. */
  helper?: string;
}

export interface BulkDeleteLinkedRecord {
  id: string;
  name: string;
  /** Small muted right-side text (e.g. stage, status, email). */
  meta?: string;
}

export interface BulkDeleteLinkedGroup {
  key: string;
  label: string;
  records: BulkDeleteLinkedRecord[];
}

export interface BulkDeleteItemSummary {
  id: string;
  name: string;
  /** Optional short subtitle (e.g. per-item counts, "3 deals · 2 contacts"). */
  subtitle?: string;
  /** Optional per-item breakdown revealed when the row is expanded. */
  linkGroups?: BulkDeleteLinkedGroup[];
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  itemLabel: string; // e.g. "account", "contact"
  items: BulkDeleteItemSummary[];
  linkTypes: LinkTypeSpec[];
  loading?: boolean;
  submitting?: boolean;
  onConfirm: (actions: LinkedRecordActionsByItem) => Promise<void> | void;
  /** Optional extra description shown below the count. */
  extraDescription?: string;
}

export const BulkDeleteLinkedRecordsDialog = ({
  open, onOpenChange, title, itemLabel, items, linkTypes, loading, submitting, onConfirm, extraDescription,
}: Props) => {
  const [actions, setActions] = useState<LinkedRecordActionsByItem>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Reset actions whenever the dialog reopens or linkTypes shape changes.
  useEffect(() => {
    if (!open) return;
    const next: LinkedRecordActionsByItem = {};
    for (const item of items) {
      next[item.id] = {};
      for (const t of linkTypes) next[item.id][t.key] = t.keepable === false ? "delete" : "keep";
    }
    setActions(next);
    setExpanded({});
  }, [open, items, linkTypes]);

  const typeByKey = new Map(linkTypes.map((t) => [t.key, t]));
  const n = items.length;
  const plural = n !== 1;
  const anyExpanded = Object.values(expanded).some(Boolean);
  const MAX_PER_GROUP = 20;

  const renderTypeControl = (itemId: string, typeKey: string) => {
    const t = typeByKey.get(typeKey);
    if (!t) return null;
    const value = actions[itemId]?.[t.key] ?? (t.keepable === false ? "delete" : "keep");
    const controlId = `${itemId}-${t.key}`;
    if (t.informational) {
      return (
        <span className="text-[11px] text-muted-foreground font-medium whitespace-nowrap">
          Reference only
        </span>
      );
    }
    if (t.keepable === false) {
      return (
        <span className="text-[11px] text-destructive font-medium whitespace-nowrap">
          Will be deleted
        </span>
      );
    }
    return (
      <RadioGroup
        value={value}
        onValueChange={(v) =>
          setActions((prev) => ({
            ...prev,
            [itemId]: { ...(prev[itemId] || {}), [t.key]: v as LinkAction },
          }))
        }
        className="flex gap-3 shrink-0"
      >
        <div className="flex items-center gap-1.5">
          <RadioGroupItem value="keep" id={`${controlId}-keep`} className="h-3.5 w-3.5" />
          <Label htmlFor={`${controlId}-keep`} className="text-[11px] font-normal cursor-pointer">
            Keep (unlink)
          </Label>
        </div>
        <div className="flex items-center gap-1.5">
          <RadioGroupItem value="delete" id={`${controlId}-del`} className="h-3.5 w-3.5" />
          <Label htmlFor={`${controlId}-del`} className="text-[11px] font-normal cursor-pointer">
            Delete with {itemLabel}{plural ? "s" : ""}
          </Label>
        </div>
      </RadioGroup>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[62.5rem] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            {title}
          </DialogTitle>
          <DialogDescription>
            You are about to permanently delete {n} {itemLabel}{plural ? "s" : ""}. This cannot be undone.
            {extraDescription ? ` ${extraDescription}` : ""}
            {" "}Expand each row to choose what happens to its linked records.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 min-h-[240px] flex items-center justify-center">
            <AppLoader variant="inline" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4">
            <div className={`border rounded-md bg-muted/30 divide-y overflow-y-auto ${anyExpanded ? "max-h-[28rem]" : "max-h-52"}`}>
              {items.map((it) => {
                const groups = (it.linkGroups || []).filter((g) => g.records.length > 0);
                const hasGroups = groups.length > 0;
                const isOpen = !!expanded[it.id];
                return (
                  <div key={it.id} className="text-sm">
                    {hasGroups ? (
                      <button
                        type="button"
                        onClick={() => setExpanded((p) => ({ ...p, [it.id]: !p[it.id] }))}
                        aria-expanded={isOpen}
                        className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-muted/60 transition-colors"
                      >
                        <span className="mt-0.5 shrink-0 text-muted-foreground">
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium truncate">{it.name || "(untitled)"}</span>
                          {it.subtitle ? (
                            <span className="block text-xs text-muted-foreground truncate">{it.subtitle}</span>
                          ) : null}
                        </span>
                      </button>
                    ) : (
                      <div className="px-3 py-2">
                        <div className="font-medium truncate">{it.name || "(untitled)"}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {it.subtitle || "No linked records"}
                        </div>
                      </div>
                    )}
                    {hasGroups && isOpen ? (
                      <div className="px-3 pb-3 pt-1 space-y-3 bg-background/60">
                        {groups.map((g) => {
                          const shown = g.records.slice(0, MAX_PER_GROUP);
                          const extra = g.records.length - shown.length;
                          return (
                            <div key={g.key} className="pl-6 rounded-md border bg-muted/20 p-2">
                              <div className="flex items-center justify-between gap-3 flex-wrap">
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                    {g.label} ({g.records.length})
                                  </div>
                                </div>
                                {renderTypeControl(it.id, g.key)}
                              </div>
                              <ul className="mt-2 space-y-0.5">
                                {shown.map((r) => (
                                  <li key={r.id} className="flex items-baseline justify-between gap-2 text-xs">
                                    <span className="truncate">{r.name || "(untitled)"}</span>
                                    {r.meta ? (
                                      <span className="shrink-0 text-muted-foreground">{r.meta}</span>
                                    ) : null}
                                  </li>
                                ))}
                                {extra > 0 ? (
                                  <li className="text-xs text-muted-foreground italic">
                                    +{extra} more
                                  </li>
                                ) : null}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={loading || submitting}
            onClick={() => onConfirm(actions)}
          >
            {submitting
              ? "Deleting..."
              : `Delete ${n} ${itemLabel}${plural ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkDeleteLinkedRecordsDialog;
