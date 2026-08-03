
import { useMemo } from "react";
import { Deal, DealStage, DEAL_STAGES } from "@/types/deal";
import { LeadStageForm } from "./LeadStageForm";
import { DiscussionsStageForm } from "./DiscussionsStageForm";
import { QualifiedStageForm } from "./QualifiedStageForm";
import { RFQStageForm } from "./RFQStageForm";
import { OfferedStageForm } from "./OfferedStageForm";
import { FinalStageForm } from "./FinalStageForm";
import { NegotiationStageForm } from "./NegotiationStageForm";
import { VerbalApprovalStageForm } from "./VerbalApprovalStageForm";
import { HoldStageForm } from "./HoldStageForm";
import { DealFormDataProvider } from "./DealFormContext";
import { recomputeDateErrors } from "@/lib/dealDateValidation";


interface DealStageFormProps {
  formData: Partial<Deal> & { id?: string };
  onFieldChange: (field: string, value: any) => void;
  onContactSelect?: (contact: any) => void;
  fieldErrors: Record<string, string>;
  stage: DealStage;
  showPreviousStages: boolean;
}

export const DealStageForm = ({ 
  formData, 
  onFieldChange, 
  onContactSelect, 
  fieldErrors, 
  stage, 
  showPreviousStages 
}: DealStageFormProps) => {
  // Live cross-field date validation — merged into fieldErrors so every stage
  // form surfaces ordering violations immediately (matches the calendar's
  // disabled-day bounds).
  const mergedFieldErrors = useMemo(() => {
    const liveDateErrors = recomputeDateErrors(formData as Record<string, any>);
    return { ...liveDateErrors, ...fieldErrors };
  }, [formData, fieldErrors]);


  const getStageIndex = (stage: DealStage): number => {
    return DEAL_STAGES.indexOf(stage);
  };

  const currentStageIndex = getStageIndex(stage);
  const isFinalStage = ['Won', 'Lost', 'Dropped', 'Hold'].includes(stage);

  const renderStageComponent = (stageToRender: DealStage) => {
    switch (stageToRender) {
      case 'Lead':
        return (
          <LeadStageForm
            isCurrent={stageToRender === stage}
            formData={formData}
            onFieldChange={onFieldChange}
            onContactSelect={onContactSelect}
            fieldErrors={mergedFieldErrors}
          />
        );
      case 'Discussions':
        return (
          <DiscussionsStageForm
            isCurrent={stageToRender === stage}
            formData={formData}
            onFieldChange={onFieldChange}
            fieldErrors={mergedFieldErrors}
          />
        );
      case 'Qualified':
        return (
          <QualifiedStageForm
            isCurrent={stageToRender === stage}
            formData={formData}
            onFieldChange={onFieldChange}
            fieldErrors={mergedFieldErrors}
          />
        );
      case 'RFQ':
        return (
          <RFQStageForm
            isCurrent={stageToRender === stage}
            formData={formData}
            onFieldChange={onFieldChange}
            fieldErrors={mergedFieldErrors}
          />
        );
      case 'Offered':
        return (
          <OfferedStageForm
            isCurrent={stageToRender === stage}
            formData={formData}
            onFieldChange={onFieldChange}
            fieldErrors={mergedFieldErrors}
          />
        );
      case 'Negotiation':
        return (
          <NegotiationStageForm
            isCurrent={stageToRender === stage}
            formData={formData}
            onFieldChange={onFieldChange}
            fieldErrors={mergedFieldErrors}
          />
        );
      case 'Verbal Approval':
        return (
          <VerbalApprovalStageForm
            isCurrent={stageToRender === stage}
            formData={formData}
            onFieldChange={onFieldChange}
            fieldErrors={mergedFieldErrors}
          />
        );
      case 'Hold':
        return (
          <HoldStageForm
            isCurrent={stageToRender === stage}
            formData={formData}
            onFieldChange={onFieldChange}
            fieldErrors={mergedFieldErrors}
          />
        );
      case 'Won':
      case 'Lost':
      case 'Dropped':
        return (
          <FinalStageForm
            isCurrent={stageToRender === stage}
            formData={formData}
            onFieldChange={onFieldChange}
            fieldErrors={mergedFieldErrors}
            stage={stageToRender}
          />
        );
      default:
        return null;
    }
  };

  // Build list of previous stages (everything before current)
  const allStages: DealStage[] = ['Lead', 'Discussions', 'Qualified', 'RFQ', 'Offered', 'Negotiation', 'Verbal Approval'];
  const previousStages: DealStage[] = [];
  if (isFinalStage) {
    previousStages.push(...allStages);
  } else {
    for (let i = 0; i < currentStageIndex && i < allStages.length; i++) {
      previousStages.push(allStages[i]);
    }
  }

  return (
    <DealFormDataProvider formData={formData}>
      <div className="space-y-3">
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
            showPreviousStages ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
          aria-hidden={!showPreviousStages}
        >
          <div className="overflow-hidden">
            <div className="space-y-3 pb-0">
              {previousStages.map(stageToRender => (
                <div key={stageToRender}>{renderStageComponent(stageToRender)}</div>
              ))}
            </div>
          </div>
        </div>
        <div>{renderStageComponent(stage)}</div>
      </div>
    </DealFormDataProvider>

  );
};

