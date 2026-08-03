
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Deal } from "@/types/deal";
import { FormFieldRenderer } from "./FormFieldRenderer";
import { StageProbabilityBadge } from "./StageProbabilityBadge";

interface DiscussionsStageFormProps {
  formData: Partial<Deal>;
  onFieldChange: (field: string, value: any) => void;
  fieldErrors: Record<string, string>;
  isCurrent?: boolean;
}

export const DiscussionsStageForm = ({ formData, onFieldChange, fieldErrors, isCurrent = true }: DiscussionsStageFormProps) => {
  const fields = [
    'customer_need',
    'customer_challenges',
    'current_solution',
    'relationship_strength',
    'next_step',
    'next_step_due_date',
    'internal_comment',
  ];
  const requiredFields = new Set(['customer_need']);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-lg">Discussions Stage</CardTitle>
          {isCurrent && <StageProbabilityBadge stage="Discussions" />}
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
              required={requiredFields.has(field)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
