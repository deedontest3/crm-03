import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { getAccountLinkedDeals, updateDealAccountId, type LinkedDeal } from "@/lib/accountLinkedDeals";
import { getContactLinkedDeals } from "@/lib/contactLinkedDeals";
import { diagnoseAccountLink, type AccountLinkDiagnostic } from "@/lib/debugDealLinking";
import { AppLoader } from "@/components/ui/loader";

type Target =
  | { kind: "account"; id: string; name: string }
  | { kind: "contact"; id: string; name: string };

interface LinkedDealsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: Target | null;
}

const formatCurrency = (value: number | null | undefined) => {
  if (value == null) return "-";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return String(value);
  }
};

const causeLabel = (cause: string) => {
  switch (cause) {
    case "saved_to_different_account":
      return "Saved to a different account";
    case "orphan_account_id":
      return "Account id points to a missing/hidden row";
    case "no_account_id_ambiguous":
      return "No account id saved — name matches multiple accounts";
    case "no_account_id_unmatched":
      return "No account id saved — no auto-match found";
    default:
      return "Related (already linked elsewhere)";
  }
};

export const LinkedDealsDialog = ({ open, onOpenChange, target }: LinkedDealsDialogProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [deals, setDeals] = useState<LinkedDeal[]>([]);
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<AccountLinkDiagnostic | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [fixingDealId, setFixingDealId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open || !target) {
      setDeals([]);
      setDiagnostic(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (target.kind === "account") {
          const linked = await getAccountLinkedDeals([{ id: target.id, account_name: target.name }]);
          if (!cancelled) setDeals(linked[target.id] || []);
        } else {
          const linked = await getContactLinkedDeals([target.id]);
          if (!cancelled) setDeals(linked[target.id] || []);
        }
      } catch (error) {
        console.error("Failed to fetch linked deals:", error);
        if (!cancelled) setDeals([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, target, reloadKey]);

  // Auto-run diagnostic when an account has 0 linked deals
  useEffect(() => {
    if (!open || !target || target.kind !== "account" || loading || deals.length > 0) {
      setDiagnostic(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setDiagLoading(true);
      try {
        const result = await diagnoseAccountLink(target.id, target.name);
        if (!cancelled) setDiagnostic(result);
      } catch (error) {
        console.error("Failed to diagnose account link:", error);
        if (!cancelled) setDiagnostic(null);
      } finally {
        if (!cancelled) setDiagLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, target, loading, deals.length, reloadKey]);

  const handleOpenDeal = (dealId: string) => {
    onOpenChange(false);
    navigate(`/deals?highlight=${dealId}`);
  };

  const handleFix = async (dealId: string) => {
    if (!target) return;
    setFixingDealId(dealId);
    try {
      await updateDealAccountId(dealId, target.id);
      toast({ title: "Deal linked", description: `Deal now linked to ${target.name}.` });
      setReloadKey((k) => k + 1);
    } catch (error) {
      console.error("Failed to link deal:", error);
      const message = error instanceof Error ? error.message : "Failed to link deal.";
      // The most common cause is a deal-validation trigger blocking the update
      // because legacy required fields (e.g. Next Step) are empty. Tell the user
      // exactly what to fix instead of a generic "Failed to link deal".
      const friendly = /next step is required/i.test(message)
        ? "This deal is missing its Next Step. Open the deal, fill in Next Step, save, then retry linking."
        : /business unit|bu\) is required/i.test(message)
        ? "This deal is missing its Business Unit. Open the deal, set the BU, save, then retry linking."
        : /competitors are required/i.test(message)
        ? "This deal needs competitors filled in. Open the deal, add competitors, save, then retry linking."
        : message;
      toast({ title: "Cannot link deal", description: friendly, variant: "destructive" });
    } finally {
      setFixingDealId(null);
    }
  };

  const titleLabel = target?.kind === "contact" ? "contact" : "account";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Deals linked to {titleLabel} "{target?.name || ""}"
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <AppLoader variant="inline" />
          </div>
        ) : deals.length === 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground py-2 text-center">
              No explicitly linked deals found for this {titleLabel}.
            </p>
            {target?.kind === "account" && (
              <div className="rounded-md border bg-muted/30 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <h3 className="font-semibold text-sm">Diagnose: why no deals?</h3>
                </div>
                {diagLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AppLoader variant="inline" /> Analyzing…
                  </div>
                ) : !diagnostic ? null : (
                  <div className="space-y-4">
                    {diagnostic.duplicateAccounts.length > 0 && (
                      <div className="text-xs">
                        <div className="font-medium text-foreground mb-1">
                          Similar account rows found ({diagnostic.duplicateAccounts.length}):
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {diagnostic.duplicateAccounts.slice(0, 12).map((a) => (
                            <Badge key={a.id} variant="outline" className="max-w-[240px] truncate">
                              {a.account_name || a.id}
                            </Badge>
                          ))}
                        </div>
                        <p className="text-muted-foreground mt-1">
                          Duplicate names cause deals to bucket under a sibling row. Consider merging in the database.
                        </p>
                      </div>
                    )}

                    {diagnostic.candidateDeals.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No deals reference this account by name, contact, or id. Nothing to fix here.
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead>Deal</TableHead>
                            <TableHead>Customer / Lead</TableHead>
                            <TableHead>Currently linked to</TableHead>
                            <TableHead>Cause</TableHead>
                            <TableHead className="text-right">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {diagnostic.candidateDeals.map((d) => (
                            <TableRow key={d.id}>
                              <TableCell>
                                <button
                                  onClick={() => handleOpenDeal(d.id)}
                                  className="text-[#2e538e] hover:underline font-medium text-left"
                                >
                                  {d.project_name || "(untitled)"}
                                </button>
                              </TableCell>
                              <TableCell className="text-xs">
                                <div>{d.customer_name || "-"}</div>
                                <div className="text-muted-foreground">{d.lead_name || ""}</div>
                              </TableCell>
                              <TableCell className="text-xs">
                                {d.current_account_name ? (
                                  <span>{d.current_account_name}</span>
                                ) : d.account_id ? (
                                  <span className="text-destructive">orphan id {d.account_id.slice(0, 8)}…</span>
                                ) : (
                                  <span className="text-muted-foreground">— none —</span>
                                )}
                                {d.candidate_account_names.length > 0 && (
                                  <div className="text-muted-foreground mt-1">
                                    candidates: {d.candidate_account_names.join(", ")}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-xs">
                                <Badge
                                  variant={
                                    d.cause === "saved_to_different_account" || d.cause === "orphan_account_id"
                                      ? "destructive"
                                      : "secondary"
                                  }
                                >
                                  {causeLabel(d.cause)}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  size="sm"
                                  disabled={fixingDealId === d.id}
                                  onClick={() => handleFix(d.id)}
                                >
                                  {fixingDealId === d.id ? (
                                    <AppLoader variant="inline" />
                                  ) : d.account_id ? (
                                    "Move here"
                                  ) : (
                                    "Link here"
                                  )}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-semibold">Project</TableHead>
                <TableHead className="font-semibold">Customer</TableHead>
                <TableHead className="font-semibold">Stage</TableHead>
                <TableHead className="font-semibold text-right">TCV</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deals.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <button
                      onClick={() => handleOpenDeal(d.id)}
                      className="text-[#2e538e] hover:underline font-medium text-left"
                    >
                      {d.project_name || "(untitled)"}
                    </button>
                  </TableCell>
                  <TableCell>{d.customer_name || "-"}</TableCell>
                  <TableCell>{d.stage || "-"}</TableCell>
                  <TableCell className="text-right">{formatCurrency(d.total_contract_value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
};