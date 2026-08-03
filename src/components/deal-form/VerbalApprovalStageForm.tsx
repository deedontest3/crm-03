import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Deal } from "@/types/deal";
import { FormFieldRenderer } from "./FormFieldRenderer";
import { StageProbabilityBadge } from "./StageProbabilityBadge";
import { DealDocumentsSection } from "./DealDocumentsSection";

interface VerbalApprovalStageFormProps {
  formData: Partial<Deal> & { id?: string };
  onFieldChange: (field: string, value: any) => void;
  fieldErrors: Record<string, string>;
  isCurrent?: boolean;
}

export const VerbalApprovalStageForm = ({ formData, onFieldChange, fieldErrors, isCurrent = true }: VerbalApprovalStageFormProps) => {
  const showPoNumber =
    formData.po_status && formData.po_status !== 'Not Required';
  const fields = [
    'verbal_approval_date',
    'po_status',
    ...(showPoNumber ? ['po_number'] : []),
    'expected_signing_date',
    'implementation_start_date',
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-lg">Verbal Approval Stage</CardTitle>
          {isCurrent && <StageProbabilityBadge stage="Verbal Approval" />}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
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
