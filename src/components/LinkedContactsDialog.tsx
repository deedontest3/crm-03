import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { getAccountLinkedContacts } from "@/lib/accountLinkedContacts";
import { AppLoader } from "@/components/ui/loader";

interface LinkedContact {
  id: string;
  contact_name: string;
  position?: string;
  email?: string;
  phone_no?: string;
}

interface LinkedContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: { id: string; account_name: string } | null;
}

export const LinkedContactsDialog = ({ open, onOpenChange, account }: LinkedContactsDialogProps) => {
  const [contacts, setContacts] = useState<LinkedContact[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !account) {
      setContacts([]);
      return;
    }

    let cancelled = false;
    const fetchContacts = async () => {
      setLoading(true);
      try {
        const linked = await getAccountLinkedContacts([account]);
        if (!cancelled) setContacts(linked[account.id] || []);
      } catch (error) {
        console.error("Failed to fetch linked contacts:", error);
        if (!cancelled) setContacts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchContacts();
    return () => { cancelled = true; };
    // Depend on account?.id only — a rename of the account shouldn't trigger a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Contacts linked to "{account?.account_name || ""}"
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <AppLoader variant="inline" />
          </div>
        ) : contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No contacts linked to this account.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-semibold">Contact Name</TableHead>
                <TableHead className="font-semibold">Position</TableHead>
                <TableHead className="font-semibold">Email</TableHead>
                <TableHead className="font-semibold">Phone</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.contact_name}</TableCell>
                  <TableCell>{c.position || "-"}</TableCell>
                  <TableCell>{c.email || "-"}</TableCell>
                  <TableCell>{c.phone_no || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
};
