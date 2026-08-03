import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Archive as ArchiveIcon, RotateCcw, Trash2 } from "lucide-react";
import { useArchivedDeals } from "@/hooks/useArchivedDeals";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";

interface ArchivedDealsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ArchivedDealsDialog = ({ open, onOpenChange }: ArchivedDealsDialogProps) => {
  const { deals, isLoading, restore, hardDelete, isRestoring, isDeleting } = useArchivedDeals();
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  const archiverIds = useMemo(
    () => Array.from(new Set(deals.map((d) => d.archived_by).filter((v): v is string => !!v))),
    [deals],
  );
  const { displayNames } = useUserDisplayNames(archiverIds);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return deals;
    return deals.filter((d) =>
      [d.project_name, d.deal_name, d.customer_name, d.stage]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [deals, search]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArchiveIcon className="w-5 h-5 text-muted-foreground" />
              Deals Archive
            </DialogTitle>
            <DialogDescription>
              Restore an archived deal or delete it permanently.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between mb-2">
            <Input
              placeholder="Search archived deals..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
          </div>

          <div className="border rounded-lg bg-card overflow-auto flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Archived by</TableHead>
                  <TableHead>Archived at</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                      No archived deals.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((d) => {
                    const projectLabel = d.project_name || d.deal_name || "(untitled)";
                    return (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{projectLabel}</TableCell>
                        <TableCell>{d.customer_name || "-"}</TableCell>
                        <TableCell>
                          {d.stage ? <Badge variant="secondary">{d.stage}</Badge> : "-"}
                        </TableCell>
                        <TableCell>
                          {d.archived_by
                            ? displayNames[d.archived_by] || d.archived_by.slice(0, 8)
                            : "-"}
                        </TableCell>
                        <TableCell>
                          {d.archived_at
                            ? format(new Date(d.archived_at), "MMM d, yyyy HH:mm")
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isRestoring}
                              onClick={() => restore(d.id)}
                            >
                              <RotateCcw className="w-4 h-4 mr-1" />
                              Restore
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={isDeleting}
                              onClick={() => setConfirmDelete({ id: d.id, name: projectLabel })}
                            >
                              <Trash2 className="w-4 h-4 mr-1" />
                              Delete permanently
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete deal?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{confirmDelete?.name}</strong> and all related
              records (action items, stakeholders, documents, activity log, revenue schedules).
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDelete) hardDelete(confirmDelete.id);
                setConfirmDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ArchivedDealsDialog;
