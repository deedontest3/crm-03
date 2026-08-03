import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { BackwardMoveChoice, Deal, DealStage, getBackwardAffectedStages, getStageLabel, stageHasOwnedData } from "@/types/deal";

interface BackwardStageConfirmDialogProps {
  open: boolean;
  currentStage: DealStage | null;
  targetStage: DealStage | null;
  deal?: Partial<Deal> | null;
  onCancel: () => void;
  onConfirm: (choice: BackwardMoveChoice) => void;
}

export const BackwardStageConfirmDialog = ({
  open,
  currentStage,
  targetStage,
  deal,
  onCancel,
  onConfirm,
}: BackwardStageConfirmDialogProps) => {
  const [choice, setChoice] = useState<BackwardMoveChoice>("keep");

  useEffect(() => {
    if (open) setChoice("keep");
  }, [open]);

  const affectedAll =
    currentStage && targetStage ? getBackwardAffectedStages(currentStage, targetStage, deal) : [];
  const affected = affectedAll.filter((stage) => stageHasOwnedData(deal, stage));
  const hasAnyData = affected.length > 0;

  const dealName =
    (deal?.deal_name as string | undefined)?.trim() ||
    (deal?.project_name as string | undefined)?.trim() ||
    "";

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {dealName
              ? `Move "${dealName}" back to ${targetStage ? getStageLabel(targetStage) : ''}?`
              : `Move deal back to ${targetStage ? getStageLabel(targetStage) : ''}?`}
          </AlertDialogTitle>
        </AlertDialogHeader>

        {hasAnyData ? (
          <div className="space-y-3 text-sm">
            <p>
              What should happen to the data already filled in{" "}
              <span className="font-medium">{affected.map(getStageLabel).join(", ")}</span>?
            </p>
            <RadioGroup
              value={choice}
              onValueChange={(v) => setChoice(v as BackwardMoveChoice)}
              className="space-y-2"
            >
              <div className="flex items-start gap-2 rounded-md border p-3">
                <RadioGroupItem value="keep" id="bw-keep" className="mt-0.5" />
                <div className="space-y-0.5">
                  <Label htmlFor="bw-keep" className="font-medium cursor-pointer">
                    Keep the data
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Only the stage and probability change. All fields remain so you can resume later.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-md border p-3">
                <RadioGroupItem value="clear" id="bw-clear" className="mt-0.5" />
                <div className="space-y-0.5">
                  <Label htmlFor="bw-clear" className="font-medium cursor-pointer">
                    Clear the data
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Reset stage-specific fields for {affected.map(getStageLabel).join(", ")}. Shared fields and revenue rows are kept.
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            This will move the deal back to {targetStage ? getStageLabel(targetStage) : ''}. No stage-specific data will be lost.
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => onConfirm(choice)}>
            Confirm move
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
