import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatMoney, type Currency } from "@/lib/revenueSchedule";

export type FinalTcvSyncMode = "tcv-only" | "tcv-and-rescale";

export interface RevisedCell {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  revenue: number;
}

interface FinalTcvSyncDialogProps {
  open: boolean;
  oldTcv: number;
  newTcv: number;
  scheduleSum: number;
  currency: Currency;
  cells?: RevisedCell[];
  onCancel: () => void;
  onApply: (mode: FinalTcvSyncMode, revisedCells?: RevisedCell[]) => void;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const buildProportional = (
  cells: RevisedCell[],
  scheduleSum: number,
  newTcv: number
): RevisedCell[] => {
  if (cells.length === 0 || scheduleSum <= 0) return cells.map(c => ({ ...c }));
  const factor = newTcv / scheduleSum;
  const scaled = cells.map(c => ({ ...c, revenue: round2(c.revenue * factor) }));
  const sumSoFar = scaled.reduce((a, c) => a + c.revenue, 0);
  const drift = round2(newTcv - sumSoFar);
  if (scaled.length > 0) {
    scaled[scaled.length - 1].revenue = Math.max(
      0,
      round2(scaled[scaled.length - 1].revenue + drift)
    );
  }
  return scaled;
};

export const FinalTcvSyncDialog = ({
  open,
  oldTcv,
  newTcv,
  scheduleSum,
  currency,
  cells = [],
  onCancel,
  onApply,
}: FinalTcvSyncDialogProps) => {
  const hasSchedule = scheduleSum > 0 && cells.length > 0;
  const [mode, setMode] = useState<FinalTcvSyncMode>(
    hasSchedule ? "tcv-and-rescale" : "tcv-only"
  );
  const [step, setStep] = useState<"choose" | "edit">("choose");
  const [revised, setRevised] = useState<RevisedCell[]>([]);

  // Reset internal state whenever the dialog opens for a fresh prompt
  useEffect(() => {
    if (open) {
      setMode(hasSchedule ? "tcv-and-rescale" : "tcv-only");
      setStep("choose");
      setRevised(cells.map(c => ({ ...c, revenue: 0 })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fmt = (n: number) => formatMoney(n, currency);

  const revisedSum = useMemo(
    () => round2(revised.reduce((a, c) => a + (Number(c.revenue) || 0), 0)),
    [revised]
  );
  const delta = round2(revisedSum - newTcv);
  const matches = Math.abs(delta) < 0.01;

  const updateCell = (idx: number, value: string) => {
    setRevised(prev => {
      const next = [...prev];
      const n = Number(value);
      next[idx] = { ...next[idx], revenue: isFinite(n) && n >= 0 ? n : 0 };
      return next;
    });
  };

  const autoDistribute = () => {
    setRevised(buildProportional(cells, scheduleSum, newTcv));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === "choose"
              ? "Update Total Contract Value?"
              : "Revise Revenue Schedule"}
          </DialogTitle>
          <DialogDescription>
            {step === "choose"
              ? "Final TCV changed. Choose how to sync the RFQ Total Contract Value and the Offered stage Revenue Schedule."
              : `Edit each Offered Revenue Schedule cell. The total must equal ${fmt(newTcv)}.`}
          </DialogDescription>
        </DialogHeader>

        {step === "choose" ? (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current TCV</span>
                <span className="font-medium">{fmt(oldTcv)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">New Final TCV</span>
                <span className="font-medium">{fmt(newTcv)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current forecast sum</span>
                <span className="font-medium">{fmt(scheduleSum)}</span>
              </div>
            </div>

            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as FinalTcvSyncMode)}
              className="space-y-2"
            >
              <div className="flex items-start space-x-2">
                <RadioGroupItem value="tcv-only" id="tcv-only" className="mt-1" />
                <Label htmlFor="tcv-only" className="font-normal cursor-pointer">
                  <span className="font-medium">Sync TCV only</span>
                  <p className="text-xs text-muted-foreground">
                    Update Total Contract Value to {fmt(newTcv)}. Forecast cells
                    remain untouched.
                  </p>
                </Label>
              </div>
              <div className="flex items-start space-x-2">
                <RadioGroupItem
                  value="tcv-and-rescale"
                  id="tcv-and-rescale"
                  className="mt-1"
                  disabled={!hasSchedule}
                />
                <Label
                  htmlFor="tcv-and-rescale"
                  className={`font-normal cursor-pointer ${!hasSchedule ? "opacity-50" : ""}`}
                >
                  <span className="font-medium">
                    Sync TCV and revise forecast{" "}
                    {hasSchedule && (
                      <span className="text-xs text-primary">(recommended)</span>
                    )}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {hasSchedule
                      ? `Review and edit each Offered Revenue Schedule cell so the sum equals ${fmt(newTcv)}.`
                      : "No forecast cells to revise."}
                  </p>
                </Label>
              </div>
            </RadioGroup>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="max-h-72 overflow-y-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Period</th>
                    <th className="px-3 py-2 text-left font-medium">Current</th>
                    <th className="px-3 py-2 text-right font-medium">Revised</th>
                  </tr>
                </thead>
                <tbody>
                  {revised.map((c, idx) => (
                    <tr key={`${c.year}-${c.quarter}`} className="border-t">
                      <td className="px-3 py-2">
                        FY{String(c.year).slice(-2)} Q{c.quarter}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {fmt(cells[idx]?.revenue ?? 0)}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={c.revenue === 0 ? "" : c.revenue}
                          placeholder="0"
                          onChange={(e) => updateCell(idx, e.target.value)}
                          className="h-8 text-right"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Target (New Final TCV)</span>
                <span className="font-medium">{fmt(newTcv)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Revised sum</span>
                <span className={`font-semibold ${matches ? "text-primary" : "text-amber-600"}`}>
                  {fmt(revisedSum)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Difference</span>
                <span className={`font-medium ${matches ? "text-primary" : "text-amber-600"}`}>
                  {delta > 0 ? "+" : ""}{fmt(delta)}
                </span>
              </div>
            </div>

          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "choose" ? (
            <>
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (mode === "tcv-and-rescale" && hasSchedule) {
                    setStep("edit");
                  } else {
                    onApply("tcv-only");
                  }
                }}
              >
                {mode === "tcv-and-rescale" && hasSchedule ? "Next" : "Apply"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep("choose")}>
                Back
              </Button>
              <Button
                onClick={() => onApply("tcv-and-rescale", revised)}
                disabled={!matches}
                title={!matches ? `Sum must equal ${fmt(newTcv)}` : undefined}
              >
                Save
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
