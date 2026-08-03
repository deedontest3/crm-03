import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Deal, DealStage, getStageLabel } from "@/types/deal";
import { FormFieldRenderer } from "@/components/deal-form/FormFieldRenderer";
import { getFieldErrors } from "@/components/deal-form/validation";

interface MissingFieldsDialogProps {
  open: boolean;
  deal: Deal | null;
  /** The stage the user is attempting to move to. */
  targetStage: DealStage | null;
  /** Stage whose required-field set should drive validation. Defaults to targetStage. */
  validationStage?: DealStage | null;
  /**
   * 'move-to-target' (default): on confirm, caller updates the deal AND moves to targetStage.
   * 'fill-current': on confirm, caller saves the fields only; the move is left to the user.
   */
  mode?: 'move-to-target' | 'fill-current';
  missingFields: string[];
  onCancel: () => void;
  onConfirm: (updates: Partial<Deal>) => Promise<void> | void;
}

/**
 * Inline modal that lets users fill required fields for a stage transition
 * directly from the kanban board, instead of being told to "open the deal".
 */
export const MissingFieldsDialog = ({
  open,
  deal,
  targetStage,
  validationStage,
  mode = 'move-to-target',
  missingFields,
  onCancel,
  onConfirm,
}: MissingFieldsDialogProps) => {
  const [values, setValues] = useState<Partial<Deal>>({});
  const [submitting, setSubmitting] = useState(false);

  const stageForValidation = (validationStage ?? targetStage) as DealStage | null;

  useEffect(() => {
    if (open) setValues({});
  }, [open, deal?.id, targetStage, stageForValidation]);

  const handleChange = (field: string, value: any) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  // Re-validate against the merged deal so the user sees live errors
  const errors = useMemo(() => {
    if (!deal || !stageForValidation) return {};
    return getFieldErrors(
      { ...deal, ...values, stage: stageForValidation },
      stageForValidation,
    );
  }, [deal, stageForValidation, values]);

  const visibleFields = useMemo(
    () => Array.from(new Set([...missingFields, ...Object.keys(errors)])),
    [missingFields, errors],
  );
  const stillMissing = visibleFields.filter((f) => errors[f]);
  const canSubmit = stillMissing.length === 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onConfirm(values);
    } finally {
      setSubmitting(false);
    }
  };

  const isFillCurrent = mode === 'fill-current';
  const targetStageLabel = targetStage ? getStageLabel(targetStage) : '';
  const validationStageLabel = stageForValidation ? getStageLabel(stageForValidation) : '';
  const title = isFillCurrent
    ? `Complete required fields for ${validationStageLabel} before moving to ${targetStageLabel}`
    : `Complete required fields to move to ${targetStageLabel}`;
  const description = isFillCurrent
    ? `${deal?.deal_name ? `"${deal.deal_name}" ` : ''}needs the following ${validationStageLabel} fields filled before it can advance to ${targetStageLabel}.`
    : `${deal?.deal_name ? `"${deal.deal_name}" ` : ''}needs the following before it can move to ${targetStageLabel}.`;
  const submitLabel = submitting
    ? 'Saving…'
    : isFillCurrent
      ? 'Save'
      : `Move to ${targetStageLabel}`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
          {visibleFields.map((field) => (
            <FormFieldRenderer
              key={field}
              field={field}
              value={(values as any)[field] ?? (deal as any)?.[field]}
              onChange={handleChange}
              error={errors[field]}
            />
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
