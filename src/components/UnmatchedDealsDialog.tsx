import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  getAmbiguousDealLinks,
  getUnmatchedDeals,
  updateDealAccountId,
  type ReviewableDealLink,
} from "@/lib/accountLinkedDeals";
import { fetchAllAccountsForLinking, type LinkableAccount } from "@/lib/dealLinkMatching";
import { AppLoader } from "@/components/ui/loader";

interface UnmatchedDealsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}

const formatCurrency = (value: number | null | undefined) => {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
};

export const UnmatchedDealsDialog = ({ open, onOpenChange, onChanged }: UnmatchedDealsDialogProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [savingDealId, setSavingDealId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [accounts, setAccounts] = useState<LinkableAccount[]>([]);
  const [deals, setDeals] = useState<ReviewableDealLink[]>([]);
  const [selectedAccountByDeal, setSelectedAccountByDeal] = useState<Record<string, string>>({});

  const loadRows = async () => {
    setLoading(true);
    try {
      const [unmatched, ambiguous, allAccounts] = await Promise.all([
        getUnmatchedDeals(),
        getAmbiguousDealLinks(),
        fetchAllAccountsForLinking(),
      ]);
      // Show ambiguous rows first — these are the silently-broken links
      // (e.g. "Magna International, Germany" colliding with another Magna account).
      setDeals([...ambiguous, ...unmatched]);
      setAccounts(allAccounts);
      setSelectedAccountByDeal({});
    } catch (error) {
      console.error("Failed to load deal link review rows:", error);
      toast({ title: "Error", description: "Failed to load unmatched deals.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    loadRows();
  }, [open]);

  const filteredDeals = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return deals;
    return deals.filter((deal) =>
      [deal.project_name, deal.customer_name, deal.lead_name, deal.stage, ...deal.candidate_account_names]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [deals, search]);

  const handleAssign = async (dealId: string) => {
    const accountId = selectedAccountByDeal[dealId];
    if (!accountId) return;

    setSavingDealId(dealId);
    try {
      await updateDealAccountId(dealId, accountId);
      toast({ title: "Deal linked", description: "The deal now has an explicit account ID." });
      await loadRows();
      onChanged?.();
    } catch (error) {
      console.error("Failed to update deal account:", error);
      const message = error instanceof Error ? error.message : "Failed to link deal to account.";
      const friendly = /business unit|bu\) is required/i.test(message)
        ? "This deal is missing its Business Unit. Open the deal, set the BU, save, then retry linking."
        : /next step is required/i.test(message)
        ? "This deal is missing its Next Step. Open the deal, set the Next Step, save, then retry linking."
        : /competitors are required/i.test(message)
        ? "This deal needs competitors filled in before this database update can be saved."
        : message;
      toast({ title: "Cannot link deal", description: friendly, variant: "destructive" });
    } finally {
      setSavingDealId(null);
    }
  };

  const handleOpenDeal = (dealId: string) => {
    onOpenChange(false);
    navigate(`/deals?highlight=${dealId}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review deal account links</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search deals..."
            className="max-w-sm"
          />
          <div className="text-sm text-muted-foreground">
            {deals.length} deal{deals.length !== 1 ? "s" : ""} need review
            {(() => {
              const ambiguousCount = deals.filter((d) => d.link_status === "ambiguous").length;
              return ambiguousCount > 0 ? (
                <span className="ml-2 text-destructive">
                  ({ambiguousCount} ambiguous — likely duplicate account names)
                </span>
              ) : null;
            })()}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <AppLoader variant="inline" />
          </div>
        ) : filteredDeals.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            All deals with available IDs are linked. No review items found.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Project</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">TCV</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead>Candidate IDs</TableHead>
                <TableHead className="min-w-[220px]">Set account ID</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDeals.map((deal) => (
                <TableRow key={deal.id}>
                  <TableCell className="font-medium">{deal.project_name || "(untitled)"}</TableCell>
                  <TableCell>{deal.customer_name || "-"}</TableCell>
                  <TableCell>{deal.lead_name || "-"}</TableCell>
                  <TableCell>{deal.stage || "-"}</TableCell>
                  <TableCell className="text-right">{formatCurrency(deal.total_contract_value)}</TableCell>
                  <TableCell>
                    <Badge variant={deal.link_status === "ambiguous" ? "destructive" : "secondary"}>
                      {deal.link_status === "ambiguous" ? "Ambiguous IDs" : "No account ID"}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    {deal.candidate_account_names.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {deal.candidate_account_names.map((name) => (
                          <Badge key={name} variant="outline" className="max-w-[180px] truncate">
                            {name}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={selectedAccountByDeal[deal.id] || ""}
                      onValueChange={(value) =>
                        setSelectedAccountByDeal((prev) => ({ ...prev, [deal.id]: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose account" />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.account_name || account.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleOpenDeal(deal.id)}>
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        disabled={!selectedAccountByDeal[deal.id] || savingDealId === deal.id}
                        onClick={() => handleAssign(deal.id)}
                      >
                        {savingDealId === deal.id ? <AppLoader variant="inline" /> : "Link"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
};