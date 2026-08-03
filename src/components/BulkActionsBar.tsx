import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { Trash2, Download, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface BulkActionsBarProps {
  selectedCount: number;
  onDelete: () => void;
  onExport: () => void;
  onClearSelection: () => void;
  className?: string;
}

export const BulkActionsBar = ({ selectedCount, onDelete, onExport, onClearSelection, className }: BulkActionsBarProps) => {
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <div className={cn("fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in", className)}>
      <div className="bg-card border rounded-lg shadow-lg px-4 py-3 flex items-center gap-3 backdrop-blur-sm"
           style={{ background: 'var(--gradient-subtle)', boxShadow: 'var(--shadow-lg)' }}>
        <Badge variant="secondary" className="text-sm font-bold px-2 py-1 bg-primary text-primary-foreground">
          {selectedCount} deal{selectedCount !== 1 ? 's' : ''}
        </Badge>

        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                onClick={onExport}
                aria-label="Export selected deals to CSV"
                className="hover-scale button-scale transition-all hover:shadow-md px-3"
              >
                <Download className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Export</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Export selected deals to CSV</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setConfirmOpen(true)}
                aria-label={`Delete ${selectedCount} selected deal${selectedCount !== 1 ? 's' : ''}`}
                className="hover-scale button-scale transition-all hover:shadow-md px-3"
              >
                <Trash2 className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Delete</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Delete selected deals</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                onClick={onClearSelection}
                aria-label="Clear selection"
                className="hover-scale button-scale transition-all p-2"
              >
                <X className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Clear selection</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedCount} deal{selectedCount !== 1 ? 's' : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The selected deal{selectedCount !== 1 ? 's' : ''} and
              their associated revenue schedules will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                onDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete {selectedCount} deal{selectedCount !== 1 ? 's' : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
