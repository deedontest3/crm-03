import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Deal, DealStage } from "@/types/deal";
import { FormFieldRenderer } from "./FormFieldRenderer";
import { useEffect, useMemo, useRef, useState } from "react";
import { StageProbabilityBadge } from "./StageProbabilityBadge";
import { currencySymbol, parseDealBudget } from "@/lib/currencyConvert";
import { AlertTriangle } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { DismissibleWarning } from "./DismissibleWarning";
import { DealDocumentsSection } from "./DealDocumentsSection";
import { monthsBetweenRounded } from "@/lib/dealDate";

interface RFQStageFormProps {
  formData: Partial<Deal> & { id?: string };
  onFieldChange: (field: string, value: any) => void;
  fieldErrors: Record<string, string>;
  isCurrent?: boolean;
}

const CURRENCIES: Array<'USD' | 'EUR' | 'INR'> = ['USD', 'EUR', 'INR'];

const monthsBetween = (startISO?: string, endISO?: string): number | null =>
  monthsBetweenRounded(startISO, endISO);

export const RFQStageForm = ({ formData, onFieldChange, fieldErrors, isCurrent = true }: RFQStageFormProps) => {
  const durationManuallySet = Boolean((formData as any).__duration_manually_set);

  // Auto-sync project_duration from start/end dates unless the user overrode it.
  useEffect(() => {
    if (durationManuallySet) return;
    const derived = monthsBetween(formData.start_date, formData.end_date);
    if (derived !== null && derived !== (Number(formData.project_duration) || 0)) {
      onFieldChange('project_duration', derived);
    }
  }, [formData.start_date, formData.end_date, formData.project_duration, durationManuallySet, onFieldChange]);

  const currency = (formData.currency_type as 'USD' | 'EUR' | 'INR' | undefined) || 'EUR';
  const tcvRaw = formData.total_contract_value;
  const tcvError = fieldErrors.total_contract_value || fieldErrors.currency_type;

  const budgetTcvWarning = useMemo(() => {
    const budget = parseDealBudget(formData.budget);
    const tcv = Number(formData.total_contract_value);
    if (!budget || budget <= 0 || !Number.isFinite(tcv) || tcv <= 0) return null;
    const diffPct = Math.abs(tcv - budget) / budget;
    if (diffPct <= 0.5) return null;
    const ratio = tcv / budget;
    return `TCV differs from Qualified budget by ${ratio.toFixed(1)}x — confirm with customer.`;
  }, [formData.budget, formData.total_contract_value]);

  const durationDriftWarning = useMemo(() => {
    const derived = monthsBetween(formData.start_date, formData.end_date);
    const stored = Number(formData.project_duration);
    if (derived === null || !Number.isFinite(stored)) return null;
    if (Math.abs(derived - stored) <= 1) return null;
    return `Project Duration (${stored}m) doesn't match start/end span (${derived}m).`;
  }, [formData.start_date, formData.end_date, formData.project_duration]);

  // Overdue warning: in RFQ stage past the expected closing date.
  const overdueWarning = useMemo(() => {
    if (formData.stage !== 'RFQ') return null;
    if (!formData.expected_closing_date) return null;
    const target = new Date(formData.expected_closing_date);
    if (isNaN(target.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    const diff = Math.floor((today.getTime() - target.getTime()) / 86400000);
    if (diff <= 0) return null;
    return `Expected RFQ closing date is overdue by ${diff} day${diff === 1 ? '' : 's'} — update RFQ status or move stage.`;
  }, [formData.stage, formData.expected_closing_date]);

  // Rejected-status disposition prompt.
  const [rejectPrompt, setRejectPrompt] = useState(false);
  const prevStatus = useRef(formData.rfq_status);
  useEffect(() => {
    if (
      formData.rfq_status === 'Rejected' &&
      prevStatus.current !== 'Rejected' &&
      prevStatus.current !== undefined
    ) {
      setRejectPrompt(true);
    }
    prevStatus.current = formData.rfq_status;
  }, [formData.rfq_status]);

  const moveStage = (stage: DealStage) => {
    onFieldChange('stage', stage);
    setRejectPrompt(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-lg">RFQ Stage</CardTitle>
          {isCurrent && <StageProbabilityBadge stage="RFQ" />}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Commercial */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Composite Total Contract Value control: currency + numeric in one field */}
          <div className="space-y-1">
            <Label>Total Contract Value</Label>
            <div className="flex">
              <Select
                value={currency}
                onValueChange={(val) => {
                  onFieldChange('currency_type', val);
                  onFieldChange('__currency_manually_set' as any, true);
                }}
              >
                <SelectTrigger className="w-[110px] rounded-r-none border-r-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {currencySymbol(c)} {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                className="rounded-l-none"
                value={tcvRaw === null || tcvRaw === undefined ? '' : String(tcvRaw)}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/[^0-9.\-]/g, '');
                  const num = cleaned === '' ? null : Number(cleaned);
                  onFieldChange('total_contract_value', num !== null && Number.isFinite(num) ? num : null);
                }}
                placeholder="0"
              />
            </div>
            {tcvError && <p className="text-sm text-destructive">{tcvError}</p>}
          </div>

          <FormFieldRenderer
            field="rfq_reference_number"
            value={formData.rfq_reference_number}
            onChange={onFieldChange}
            error={fieldErrors.rfq_reference_number}
          />
          <FormFieldRenderer
            field="rfq_status"
            value={formData.rfq_status}
            onChange={onFieldChange}
            error={fieldErrors.rfq_status}
            required
          />
        </div>

        {/* Dates */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {['rfq_received_date', 'proposal_due_date', 'expected_closing_date', 'start_date', 'end_date'].map(field => (
            <FormFieldRenderer
              key={field}
              field={field}
              value={formData[field as keyof Deal]}
              onChange={onFieldChange}
              error={fieldErrors[field]}
            />
          ))}
          <FormFieldRenderer
            field="project_duration"
            value={formData.project_duration}
            onChange={(f, v) => {
              onFieldChange('__duration_manually_set' as any, true);
              onFieldChange(f, v);
            }}
            error={fieldErrors.project_duration}
          />
        </div>

        {/* Documents — upload a file or add a link */}
        <div className="pt-1">
          <DealDocumentsSection
            dealId={formData.id}
            showRfqSubmittedSlot
            requireRfqSubmitted={formData.rfq_status === 'Submitted'}
          />
        </div>

        {/* Action items */}
        <div className="grid grid-cols-1 gap-3">
          <FormFieldRenderer
            field="action_items"
            value={formData.action_items}
            onChange={onFieldChange}
            error={fieldErrors.action_items}
          />
        </div>

        {overdueWarning && (
          <DismissibleWarning
            storageKey={`rfq-overdue:${formData.id ?? 'new'}`}
            message={overdueWarning}
          />
        )}
        {budgetTcvWarning && (
          <DismissibleWarning
            storageKey={`rfq-budget-tcv:${formData.id ?? 'new'}`}
            message={budgetTcvWarning}
          />
        )}
        {durationDriftWarning && (
          <DismissibleWarning
            storageKey={`rfq-duration-drift:${formData.id ?? 'new'}`}
            message={durationDriftWarning}
          />
        )}
      </CardContent>

      <AlertDialog open={rejectPrompt} onOpenChange={setRejectPrompt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>RFQ marked Rejected</AlertDialogTitle>
            <AlertDialogDescription>
              Would you like to move this deal to a closing stage?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel>Stay on RFQ</AlertDialogCancel>
            <Button variant="outline" onClick={() => moveStage('Dropped')}>
              Move to Dropped
            </Button>
            <AlertDialogAction onClick={() => moveStage('Lost')}>
              Move to Lost
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
