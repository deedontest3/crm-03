import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Deal } from "@/types/deal";
import { FormFieldRenderer } from "./FormFieldRenderer";
import { StageProbabilityBadge } from "./StageProbabilityBadge";
import { currencySymbol, formatMoney, parseDealBudget } from "@/lib/currencyConvert";

interface QualifiedStageFormProps {
  formData: Partial<Deal>;
  onFieldChange: (field: string, value: any) => void;
  fieldErrors: Record<string, string>;
  isCurrent?: boolean;
}

const CURRENCIES: Array<'USD' | 'EUR' | 'INR'> = ['USD', 'EUR', 'INR'];

export const QualifiedStageForm = ({ formData, onFieldChange, fieldErrors, isCurrent = true }: QualifiedStageFormProps) => {
  // currency_type + budget collapsed into one composite "Amount (Budget)" control.
  // Remaining fields render in the required order after the budget control.
  const fields = ['opportunity_description', 'expected_closing_date', 'is_recurring'];

  const currency = (formData.currency_type as 'USD' | 'EUR' | 'INR' | undefined) || 'EUR';
  const budgetRaw = formData.budget;
  const budgetNum = parseDealBudget(budgetRaw);
  const previewText =
    budgetNum !== null ? formatMoney(budgetNum, currency) : (budgetRaw ? String(budgetRaw) : '');

  const combinedError = fieldErrors.budget || fieldErrors.currency_type;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-lg">Qualified Stage</CardTitle>
          {isCurrent && <StageProbabilityBadge stage="Qualified" />}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Composite Amount (Budget) control: currency + numeric in one field */}
          <div className="space-y-1">
            <Label>Amount (Budget)</Label>
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
                value={budgetRaw === null || budgetRaw === undefined ? '' : String(budgetRaw)}
                onChange={(e) => {
                  const v = e.target.value;
                  // Strip any stray symbols/commas the user might paste in.
                  const cleaned = v.replace(/[^0-9.\-]/g, '');
                  // budget is a numeric column: emit a number, or null when empty.
                  const num = cleaned === '' ? null : Number(cleaned);
                  onFieldChange('budget', num !== null && Number.isFinite(num) ? num : (cleaned === '' ? null : cleaned));
                }}
                placeholder="0"
              />
            </div>
            {combinedError && (
              <p className="text-sm text-destructive">{combinedError}</p>
            )}
          </div>

          {fields.map(field => (
            <FormFieldRenderer
              key={field}
              field={field}
              value={formData[field as keyof Deal]}
              onChange={onFieldChange}
              error={fieldErrors[field]}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
