
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export interface DealColumnConfig {
  field: string;
  label: string;
  visible: boolean;
  order: number;
}

interface DealColumnCustomizerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: DealColumnConfig[];
  onColumnsChange: (columns: DealColumnConfig[]) => void;
}

export const DealColumnCustomizer = ({ 
  open, 
  onOpenChange, 
  columns, 
  onColumnsChange 
}: DealColumnCustomizerProps) => {
  const [localColumns, setLocalColumns] = useState<DealColumnConfig[]>(columns);

  const handleVisibilityChange = (field: string, visible: boolean) => {
    const updatedColumns = localColumns.map(col => 
      col.field === field ? { ...col, visible } : col
    );
    setLocalColumns(updatedColumns);
  };

  const handleSave = () => {
    onColumnsChange(localColumns);
    onOpenChange(false);
  };

  const handleReset = () => {
    const defaultColumns: DealColumnConfig[] = [
      { field: 'project_name', label: 'Project', visible: true, order: 0 },
      { field: 'customer_name', label: 'Customer', visible: true, order: 1 },
      { field: 'lead_name', label: 'Lead Name', visible: true, order: 2 },
      { field: 'lead_owner', label: 'Lead Owner', visible: true, order: 3 },
      { field: 'stage', label: 'Stage', visible: true, order: 4 },
      { field: 'priority', label: 'Priority', visible: true, order: 5 },
      { field: 'total_contract_value', label: 'Value', visible: true, order: 6 },
      { field: 'probability', label: 'Probability', visible: true, order: 7 },
      { field: 'expected_closing_date', label: 'Target Closure date', visible: true, order: 8 },
      { field: 'region', label: 'Region', visible: false, order: 9 },
      { field: 'project_duration', label: 'Duration', visible: false, order: 10 },
      { field: 'start_date', label: 'Start Date', visible: false, order: 11 },
      { field: 'end_date', label: 'End Date', visible: false, order: 12 },
      { field: 'proposal_due_date', label: 'Proposal Due', visible: false, order: 13 },
      { field: 'total_revenue', label: 'Total Revenue', visible: false, order: 14 },
    ];
    setLocalColumns(defaultColumns);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Columns</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
            <strong>Tip:</strong> Check/uncheck to show/hide columns in the deal table.
          </div>
          
          <div className="space-y-2 max-h-[400px] overflow-y-auto p-1">
            {localColumns.map((column) => (
              <div
                key={column.field}
                className="flex items-center space-x-3 p-3 border rounded-lg bg-card hover:bg-muted/30"
              >
                <Checkbox
                  id={column.field}
                  checked={column.visible}
                  onCheckedChange={(checked) => 
                    handleVisibilityChange(column.field, Boolean(checked))
                  }
                />
                
                <Label
                  htmlFor={column.field}
                  className="flex-1 cursor-pointer"
                >
                  {column.label}
                </Label>
              </div>
            ))}
          </div>
          
          <div className="flex justify-between gap-3 pt-4 border-t">
            <Button variant="outline" onClick={handleReset}>
              Reset to Default
            </Button>
            <Button onClick={handleSave}>
              Apply Changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
