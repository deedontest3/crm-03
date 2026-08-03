import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Lock, RotateCcw } from "lucide-react";

export interface AccountColumnConfig {
  field: string;
  label: string;
  visible: boolean;
  order: number;
}

interface AccountColumnCustomizerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: AccountColumnConfig[];
  onColumnsChange: (columns: AccountColumnConfig[]) => void;
  /** Optional — when provided, a "Reset to defaults" button appears. */
  defaultColumns?: AccountColumnConfig[];
}

export const AccountColumnCustomizer = ({
  open,
  onOpenChange,
  columns,
  onColumnsChange,
  defaultColumns,
}: AccountColumnCustomizerProps) => {
  const handleToggleColumn = (field: string) => {
    const updated = columns.map(col =>
      col.field === field ? { ...col, visible: !col.visible } : col
    );
    onColumnsChange(updated);
  };

  const handleShowAll = () => {
    const updated = columns.map(col => ({ ...col, visible: true }));
    onColumnsChange(updated);
  };

  const handleHideAll = () => {
    // Keep account_name and status always visible
    const updated = columns.map(col => ({
      ...col,
      visible: col.field === 'account_name' || col.field === 'status'
    }));
    onColumnsChange(updated);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Customize Columns</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleShowAll}>
              Show All
            </Button>
            <Button variant="outline" size="sm" onClick={handleHideAll}>
              Hide All
            </Button>
            {defaultColumns && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onColumnsChange(defaultColumns)}
                className="gap-1 ml-auto"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {columns.map((column) => {
              const locked = column.field === 'account_name' || column.field === 'status';
              return (
                <div key={column.field} className="flex items-center space-x-2">
                  <Checkbox
                    id={column.field}
                    checked={column.visible}
                    onCheckedChange={() => handleToggleColumn(column.field)}
                    disabled={locked}
                  />
                  <Label
                    htmlFor={column.field}
                    className={`text-sm font-normal cursor-pointer flex items-center gap-1 ${locked ? 'text-muted-foreground' : ''}`}
                    title={locked ? 'Required column — always visible' : undefined}
                  >
                    {column.label}
                    {locked && <Lock className="h-3 w-3" aria-label="Always visible" />}
                  </Label>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
