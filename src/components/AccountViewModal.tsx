import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExternalLink, Pencil, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { AppLoader } from "@/components/ui/loader";

interface AccountDetail {
  id: string;
  account_name: string;
  phone?: string;
  website?: string;
  industry?: string;
  company_type?: string;
  country?: string;
  region?: string;
  status?: string;
  description?: string;
  account_owner?: string;
  currency?: string;
  created_time?: string;
  modified_time?: string;
}

interface AccountViewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preferred — unambiguous lookup by primary key. */
  accountId?: string | null;
  /** Fallback — used only when accountId is not provided. Duplicate names return the most recently created match. */
  accountName?: string | null;
  /** Optional — when provided, an "Edit" button appears in the header. */
  onEdit?: (account: AccountDetail) => void;
}

const statusBadgeClass = (status?: string) => {
  switch (status) {
    case "New": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
    case "Working": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
    case "Qualified": return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
    case "Inactive": return "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
    default: return "bg-muted text-muted-foreground";
  }
};

export const AccountViewModal = ({ open, onOpenChange, accountId, accountName, onEdit }: AccountViewModalProps) => {
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ownerIds = account?.account_owner ? [account.account_owner] : [];
  const { displayNames } = useUserDisplayNames(ownerIds);

  useEffect(() => {
    if (!open || (!accountId && !accountName)) {
      setAccount(null);
      setAmbiguous(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const fetchAccount = async () => {
      setLoading(true);
      setAmbiguous(false);
      setError(null);
      try {
        if (accountId) {
          const { data, error: err } = await supabase
            .from("accounts")
            .select("*")
            .eq("id", accountId)
            .maybeSingle();
          if (cancelled) return;
          if (err) throw err;
          if (data) setAccount(data);
        } else if (accountName) {
          // Name-based fallback — deterministic (newest first, NULL created_time last)
          // and flag duplicates so the UI can warn.
          const { data, error: err } = await supabase
            .from("accounts")
            .select("*")
            .eq("account_name", accountName)
            .order("created_time", { ascending: false, nullsFirst: false })
            .order("id", { ascending: true })
            .limit(2);
          if (cancelled) return;
          if (err) throw err;
          if (data && data.length > 0) {
            setAccount(data[0]);
            setAmbiguous(data.length > 1);
          }
        }
      } catch (e: any) {
        if (cancelled) return;
        console.error("AccountViewModal: fetch failed", e);
        setError(e?.message || "Failed to load account.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchAccount();
    return () => { cancelled = true; };
  }, [open, accountId, accountName]);

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm">{children || "-"}</p>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span>Account Details</span>
            {onEdit && account && (
              <Button size="sm" variant="outline" className="gap-1" onClick={() => { onEdit(account); onOpenChange(false); }}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <AppLoader variant="inline" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-sm font-medium">Couldn't load this account</p>
            <p className="text-xs text-muted-foreground max-w-sm">{error}</p>
          </div>
        ) : !account ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Account not found.</p>
        ) : (
          <>
            {ambiguous && (
              <p className="text-xs rounded border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900 text-amber-700 px-3 py-2">
                Multiple accounts share this name — showing the most recently created one.
              </p>
            )}
          <div className="grid grid-cols-2 gap-4 pt-2">

            <Field label="Account Name">{account.account_name}</Field>
            <Field label="Status">
              {account.status ? (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass(account.status)}`}>
                  {account.status}
                </span>
              ) : "-"}
            </Field>
            <Field label="Phone">{account.phone}</Field>
            <Field label="Website">
              {account.website ? (
                <a
                  href={account.website.startsWith("http") ? account.website : `https://${account.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  {account.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : "-"}
            </Field>
            <Field label="Industry">{account.industry}</Field>
            <Field label="Company Type">{account.company_type}</Field>
            <Field label="Country">{account.country}</Field>
            <Field label="Region">{account.region}</Field>
            <Field label="Currency">{account.currency}</Field>
            <Field label="Account Owner">
              {account.account_owner ? displayNames[account.account_owner] || "Loading..." : "-"}
            </Field>
            <div className="col-span-2">
              <Field label="Description">{account.description}</Field>
            </div>
            <Field label="Created">
              {account.created_time ? format(new Date(account.created_time), "dd MMM yyyy") : "-"}
            </Field>
            <Field label="Last Modified">
              {account.modified_time ? format(new Date(account.modified_time), "dd MMM yyyy") : "-"}
            </Field>
          </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
