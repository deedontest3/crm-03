import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Deal } from "@/types/deal";
import { FormFieldRenderer } from "./FormFieldRenderer";
import { StageProbabilityBadge } from "./StageProbabilityBadge";

interface HoldStageFormProps {
  formData: Partial<Deal>;
  onFieldChange: (field: string, value: any) => void;
  fieldErrors: Record<string, string>;
  isCurrent?: boolean;
}

export const HoldStageForm = ({ formData, onFieldChange, fieldErrors, isCurrent = true }: HoldStageFormProps) => {
  const fields = [
    'hold_reason',
    'revise_date',
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-lg">Hold Stage</CardTitle>
          {isCurrent && <StageProbabilityBadge stage="Hold" />}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
