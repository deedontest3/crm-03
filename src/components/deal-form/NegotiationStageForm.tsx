import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Deal } from "@/types/deal";
import { FormFieldRenderer } from "./FormFieldRenderer";
import { StageProbabilityBadge } from "./StageProbabilityBadge";

interface NegotiationStageFormProps {
  formData: Partial<Deal>;
  onFieldChange: (field: string, value: any) => void;
  fieldErrors: Record<string, string>;
  isCurrent?: boolean;
}

export const NegotiationStageForm = ({ formData, onFieldChange, fieldErrors, isCurrent = true }: NegotiationStageFormProps) => {
  const showCompetitors = formData.competition === 'Yes';

  // Clear competitors when competition is not Yes, so stale text doesn't persist.
  useEffect(() => {
    if (!showCompetitors && formData.competitors) {
      onFieldChange('competitors', '');
    }
  }, [showCompetitors, formData.competitors, onFieldChange]);

  const fields = [
    'customer_objection',
    'competition',
    ...(showCompetitors ? ['competitors'] : []),
    'final_tcv',
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-lg">Negotiation Stage</CardTitle>
          {isCurrent && <StageProbabilityBadge stage="Negotiation" />}
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
