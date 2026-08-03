import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { History } from "lucide-react";
import { DealActivityLog } from "./DealActivityLog";

interface DealActivityLogDialogProps {
  dealId?: string;
  dealName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const DealActivityLogDialog = ({
  dealId,
  dealName,
  open,
  onOpenChange,
}: DealActivityLogDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4" />
            Logs
            {dealName ? <span className="text-muted-foreground font-normal">— {dealName}</span> : null}
          </DialogTitle>
          <DialogDescription>
            Full audit trail of changes for this deal, including field edits, stage transitions, and stakeholder actions.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          <DealActivityLog dealId={dealId} scrollHeight="h-[60vh]" />
        </div>
      </DialogContent>
    </Dialog>
  );
};
