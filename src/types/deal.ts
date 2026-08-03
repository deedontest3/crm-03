export type DealStage = 'Lead' | 'Discussions' | 'Qualified' | 'RFQ' | 'Offered' | 'Negotiation' | 'Verbal Approval' | 'Won' | 'Lost' | 'Hold' | 'Dropped';

export type BackwardMoveChoice = 'keep' | 'clear';

export interface BackwardStageMoveRequest<TDeal extends Partial<Deal> = Partial<Deal>> {
  dealId: string;
  deal?: TDeal | null;
  currentStage: DealStage;
  targetStage: DealStage;
}

export interface RevenueScheduleEntry {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  revenue: number;
}

export type BUOption = 'EBU' | 'RT' | 'MBU';
export const BU_OPTIONS: BUOption[] = ['EBU', 'RT', 'MBU'];

export interface Deal {
  id: string;
  created_at: string;
  modified_at: string;
  created_by: string | null;
  modified_by: string | null;
  
  // Basic deal info
  deal_name: string;
  stage: DealStage;
  
  // Lead stage fields
  project_name?: string;
  customer_name?: string;
  account_id?: string | null;
  lead_name?: string;
  lead_owner?: string;
  region?: string;
  priority?: number; // 1-5 range enforced by DB constraint
  probability?: number; // 0-100 range enforced by DB constraint
  internal_comment?: string;

  // Business segmentation (new)
  bu?: BUOption[];
  ai?: 'Yes' | 'No';
  strategic?: 'Yes' | 'No';
  
  // Discussions stage fields
  expected_closing_date?: string;
  customer_need?: string;
  customer_challenges?: 'Open' | 'Ongoing' | 'Done';
  current_solution?: string;
  relationship_strength?: 'Low' | 'Medium' | 'High';
  next_step?: string;
  next_step_due_date?: string;

  
  // Qualified stage fields
  budget?: number;
  business_value?: 'Open' | 'Ongoing' | 'Done';
  decision_maker_level?: 'Open' | 'Ongoing' | 'Done';
  is_recurring?: 'Yes' | 'No' | 'Unclear';
  opportunity_description?: string;

  // RFQ stage fields
  total_contract_value?: number;
  currency_type?: 'EUR' | 'USD' | 'INR';
  start_date?: string;
  end_date?: string;
  project_duration?: number;
  action_items?: string;
  rfq_received_date?: string;
  proposal_due_date?: string;
  rfq_status?: 'Drafted' | 'Submitted' | 'Rejected' | 'Accepted';
  rfq_reference_number?: string;
  
  // Offered stage fields
  current_status?:
    | 'Proposal Sent'
    | 'Proposal Reviewed'
    | 'Customer Questions'
    | 'Commercial Discussion'
    | 'Technical Clarification'
    | 'Waiting for Customer'
    | 'Internal Approval'
    | 'Revision Requested'
    | 'Final Evaluation';
  closing?: 'On Track' | 'Pushed' | 'Slipping' | 'Ready to Close' | 'At Risk';
  proposal_version?: string;
  proposal_sent_date?: string;
  next_follow_up_date?: string;
  
  
  // Won stage fields
  won_reason?: string;
  quarterly_revenue_q1?: number;
  quarterly_revenue_q2?: number;
  quarterly_revenue_q3?: number;
  quarterly_revenue_q4?: number;
  total_revenue?: number;
  signed_contract_date?: string;
  implementation_start_date?: string;
  handoff_status?: 'Not Started' | 'In Progress' | 'Complete';
  
  // Lost stage fields
  lost_reason?: string;

  // Dropped stage fields
  drop_reason?: string;

  // Lead stage extras
  opportunity_summary?: string;

  // Negotiation stage fields
  customer_objection?: string;
  competition?: 'Yes' | 'No';
  competitors?: string;
  final_tcv?: number;

  // Verbal Approval stage fields
  po_status?: 'Not Required' | 'Awaiting PO' | 'In Process' | 'Received';
  po_number?: string;
  expected_signing_date?: string;
  verbal_approval_date?: string;


  // Hold stage fields
  hold_reason?: 'Budget Freeze' | 'Project Delayed' | 'Waiting Approval' | 'Procurement Delay' | 'Technical Review' | 'Resource Constraint' | 'Customer Request' | 'Other';
  revise_date?: string;

  // Stakeholder contacts
  budget_owner_contact_id?: string;
  champion_contact_id?: string;
  objector_contact_id?: string;
  influencer_contact_id?: string;
}

export const DEAL_STAGES: DealStage[] = ['Lead', 'Discussions', 'Qualified', 'RFQ', 'Offered', 'Negotiation', 'Verbal Approval', 'Won', 'Lost', 'Hold', 'Dropped'];

export const PIPELINE_STAGES: DealStage[] = ['Lead', 'Discussions', 'Qualified', 'RFQ', 'Offered', 'Negotiation', 'Verbal Approval'];

/** Stages that close or pause the normal forward pipeline. */
export const TERMINAL_STAGES: DealStage[] = ['Won', 'Lost', 'Hold', 'Dropped'];

/**
 * Closed-Won is treated as booked revenue and is effectively immutable
 * (Salesforce / HubSpot / Pipedrive behaviour). Non-admin users cannot move
 * a deal out of Won at all. Admin / Super Admin may only *reopen* it to
 * "Verbal Approval" — never to Lost, Hold, or Dropped (those would mis-state
 * closed-won revenue) and never several stages backward in one jump.
 */
export const isTransitionAllowed = (
  from: DealStage,
  to: DealStage,
  _opts: { isAdmin?: boolean } = {},
): { allowed: boolean; reason?: string } => {
  if (from === to) return { allowed: true };
  if (from === 'Won') {
    return {
      allowed: false,
      reason: 'Won deals are closed and cannot be moved to another stage.',
    };
  }
  return { allowed: true };
};

/** Non-final pipeline stages that contribute to the weighted forecast. Excludes Won, Lost, Hold, Dropped. */
export const NON_FINAL_STAGES: DealStage[] = [...PIPELINE_STAGES];

export const STAGE_PROBABILITY: Record<DealStage, number> = {
  Lead: 0,
  Discussions: 10,
  Qualified: 20,
  RFQ: 30,
  Offered: 50,
  Negotiation: 70,
  'Verbal Approval': 90,
  Won: 100,
  Lost: 0,
  Hold: 0,
  Dropped: 0,
};

export const STAGE_COLORS: Record<DealStage, string> = {
  Lead: 'text-stage-lead-foreground',
  Discussions: 'text-stage-discussions-foreground',
  Qualified: 'text-stage-qualified-foreground',
  RFQ: 'text-stage-rfq-foreground',
  Offered: 'text-stage-offered-foreground',
  Negotiation: 'text-stage-negotiation-foreground',
  'Verbal Approval': 'text-stage-verbal-approval-foreground',
  Won: 'text-stage-won-foreground',
  Lost: 'text-stage-lost-foreground',
  Hold: 'text-stage-hold-foreground',
  Dropped: 'text-stage-dropped-foreground',
};

/**
 * Display labels for stages. Pipeline stages get an `Lx - ` prefix
 * (reverse order: Won is L0, Lead is L7). Lost/Hold/Dropped render plain.
 * Internal `DealStage` values are unchanged.
 */
export const STAGE_LABELS: Record<DealStage, string> = {
  Won: 'L0 - Won',
  'Verbal Approval': 'L1 - Verbal Approval',
  Negotiation: 'L2 - Negotiation',
  Offered: 'L3 - Offered',
  RFQ: 'L4 - RFQ',
  Qualified: 'L5 - Qualified',
  Discussions: 'L6 - Discussions',
  Lead: 'L7 - Lead',
  Lost: 'Lost',
  Hold: 'Hold',
  Dropped: 'Dropped',
};

export const getStageLabel = (stage: DealStage): string => STAGE_LABELS[stage] ?? stage;

export const STAGE_BG_COLORS: Record<DealStage, string> = {
  Lead: 'bg-stage-lead border-stage-lead-foreground/30',
  Discussions: 'bg-stage-discussions border-stage-discussions-foreground/30',
  Qualified: 'bg-stage-qualified border-stage-qualified-foreground/30',
  RFQ: 'bg-stage-rfq border-stage-rfq-foreground/30',
  Offered: 'bg-stage-offered border-stage-offered-foreground/30',
  Negotiation: 'bg-stage-negotiation border-stage-negotiation-foreground/30',
  'Verbal Approval': 'bg-stage-verbal-approval border-stage-verbal-approval-foreground/30',
  Won: 'bg-stage-won border-stage-won-foreground/30',
  Lost: 'bg-stage-lost border-stage-lost-foreground/30',
  Hold: 'bg-stage-hold border-stage-hold-foreground/30',
  Dropped: 'bg-stage-dropped border-stage-dropped-foreground/30',
};

export const getStageIndex = (stage: DealStage): number => {
  return DEAL_STAGES.indexOf(stage);
};

export const getPipelineStageIndex = (stage: DealStage): number => {
  return PIPELINE_STAGES.indexOf(stage);
};

export const isForwardPipelineMove = (from: DealStage, to: DealStage): boolean => {
  const fromIdx = getPipelineStageIndex(from);
  const toIdx = getPipelineStageIndex(to);
  return fromIdx >= 0 && toIdx > fromIdx;
};

export const isBackwardPipelineMove = (from: DealStage, to: DealStage): boolean => {
  const fromIdx = getPipelineStageIndex(from);
  const toIdx = getPipelineStageIndex(to);
  if (toIdx < 0) return false;
  if (fromIdx >= 0) return toIdx < fromIdx;

  // Returning from a terminal/pause stage back into the active pipeline is also
  // a rollback: terminal-stage fields such as Won/Lost/Dropped/Hold reasons may
  // need an explicit keep-vs-clear decision.
  return TERMINAL_STAGES.includes(from);
};

/**
 * Pipeline moves must be one stage at a time. Terminal stages (Won/Lost/Hold/
 * Dropped) are exempt and may be reached from any pipeline stage.
 * Returns true when the move is allowed by the adjacency rule.
 */
export const isAdjacentPipelineMove = (from: DealStage, to: DealStage): boolean => {
  const fromIdx = getPipelineStageIndex(from);
  const toIdx = getPipelineStageIndex(to);
  // Either side terminal → not constrained by adjacency.
  if (fromIdx < 0 || toIdx < 0) return true;
  return Math.abs(toIdx - fromIdx) <= 1;
};

/** When a multi-stage pipeline jump is attempted, return the single next stage
 * the user should move to first. */
export const getNextPipelineStage = (from: DealStage, to: DealStage): DealStage | null => {
  const fromIdx = getPipelineStageIndex(from);
  const toIdx = getPipelineStageIndex(to);
  if (fromIdx < 0 || toIdx < 0) return null;
  if (toIdx === fromIdx) return null;
  return PIPELINE_STAGES[fromIdx + (toIdx > fromIdx ? 1 : -1)] ?? null;
};

export const getFieldsForStage = (stage: DealStage): string[] => {
  const stageIndex = getStageIndex(stage);
  const allStages = [
    // Lead fields
    ['project_name', 'lead_name', 'customer_name', 'region', 'lead_owner', 'priority', 'bu', 'ai', 'strategic', 'opportunity_summary'],
    // Discussions fields  
    ['customer_need', 'customer_challenges', 'current_solution', 'relationship_strength', 'next_step', 'next_step_due_date', 'internal_comment'],
    // Qualified fields
    ['budget', 'opportunity_description', 'business_value', 'decision_maker_level', 'expected_closing_date', 'is_recurring', 'probability'],
    // RFQ fields
    ['total_contract_value', 'currency_type', 'rfq_reference_number', 'start_date', 'end_date', 'project_duration', 'rfq_received_date', 'proposal_due_date', 'rfq_status', 'action_items'],
    // Offered fields (L12: no re-listing of Qualified fields)
    ['current_status', 'closing'],
  ];
  
  let availableFields: string[] = [];
  for (let i = 0; i <= stageIndex && i < allStages.length; i++) {
    availableFields = [...availableFields, ...allStages[i]];
  }
  
  // Add stage-specific fields based on the current stage
  if (stage === 'Negotiation') {
    availableFields.push('customer_objection', 'competition', 'competitors', 'final_tcv');
  } else if (stage === 'Verbal Approval') {
    availableFields.push('customer_objection', 'competition', 'competitors', 'final_tcv');
    availableFields.push('verbal_approval_date', 'po_status', 'po_number', 'expected_signing_date', 'implementation_start_date');

  } else if (stage === 'Hold') {
    availableFields.push('hold_reason', 'revise_date');
  } else if (stage === 'Won') {
    availableFields.push('won_reason', 'quarterly_revenue_q1', 'quarterly_revenue_q2', 'quarterly_revenue_q3', 'quarterly_revenue_q4', 'total_revenue', 'signed_contract_date', 'implementation_start_date', 'handoff_status', 'po_status', 'po_number');
  } else if (stage === 'Lost') {
    availableFields.push('lost_reason');
  } else if (stage === 'Dropped') {
    availableFields.push('drop_reason');
  }
  
  // Always include internal_comment field
  if (!availableFields.includes('internal_comment')) {
    availableFields.push('internal_comment');
  }
  
  return availableFields;
};

export const getEditableFieldsForStage = (stage: DealStage): string[] => {
  // All fields are always editable according to requirements
  return getFieldsForStage(stage);
};

/**
 * Per-stage required fields. Returns ONLY the fields owned by `stage`.
 * Validation on stage moves is "exit-based": leaving `stage` forward requires
 * these fields to be filled. Entering a new stage does not require its own
 * fields immediately — the user fills them while the deal sits there.
 */
export const getRequiredFieldsForStage = (stage: DealStage): string[] => {
  const requiredFields: Partial<Record<DealStage, string[]>> = {
    Lead: ['project_name', 'customer_name', 'lead_name', 'bu'],
    Discussions: ['customer_need'],
    Qualified: ['budget'],
    RFQ: ['total_contract_value', 'rfq_status'],
    // Offered: revenue schedule gating is enforced separately in DealForm save flow.
    Offered: [],
    Negotiation: ['final_tcv'],
    'Verbal Approval': ['verbal_approval_date', 'expected_signing_date'],
    Hold: ['hold_reason', 'revise_date'],
    // Won: revenue schedule + duration checks live in validateWonStage().
    Won: ['signed_contract_date', 'implementation_start_date', 'end_date', 'won_reason', 'handoff_status'],
    Lost: ['lost_reason'],
    Dropped: ['drop_reason'],
  };
  return requiredFields[stage] || [];
};

/** True when moving from `from` to `to` advances along the pipeline. */
export const isForwardMove = (from: DealStage, to: DealStage): boolean => {
  return isForwardPipelineMove(from, to);
};


export const getNextStage = (currentStage: DealStage): DealStage | null => {
  const stageFlow: Partial<Record<DealStage, DealStage | null>> = {
    Lead: 'Discussions',
    Discussions: 'Qualified',
    Qualified: 'RFQ',
    RFQ: 'Offered',
    Offered: 'Negotiation',
    Negotiation: 'Verbal Approval',
    'Verbal Approval': 'Won',
  };
  return stageFlow[currentStage] ?? null;
};

export const getFinalStageOptions = (): DealStage[] => {
  return ['Won', 'Lost', 'Dropped'];
};

/**
 * Fields uniquely owned by each stage. Used when moving a deal backward
 * and the user chooses to clear data captured in the stages being unwound.
 * Shared/global fields (project_name, account/contact, owner, region, priority,
 * bu, ai, strategic, internal_comment, action_items metadata, currency, etc.)
 * are intentionally excluded so they survive a rollback.
 */
export const getStageOwnedFields = (stage: DealStage): (keyof Deal)[] => {
  const map: Partial<Record<DealStage, (keyof Deal)[]>> = {
    Discussions: ['customer_need', 'customer_challenges', 'current_solution', 'relationship_strength', 'next_step', 'next_step_due_date'],
    Qualified: ['budget', 'opportunity_description', 'business_value', 'decision_maker_level', 'expected_closing_date', 'is_recurring'],
    RFQ: ['total_contract_value', 'rfq_reference_number', 'start_date', 'end_date', 'project_duration', 'rfq_received_date', 'proposal_due_date', 'rfq_status'],
    Offered: ['current_status', 'closing'],
    Negotiation: ['customer_objection', 'competition', 'competitors', 'final_tcv'],
    'Verbal Approval': ['po_status', 'po_number', 'expected_signing_date', 'verbal_approval_date', 'implementation_start_date'],
    Won: ['won_reason', 'signed_contract_date', 'handoff_status', 'total_revenue', 'quarterly_revenue_q1', 'quarterly_revenue_q2', 'quarterly_revenue_q3', 'quarterly_revenue_q4'],
    Lost: ['lost_reason'],
    Hold: ['hold_reason', 'revise_date'],
    Dropped: ['drop_reason'],
  };
  return map[stage] ?? [];
};

const hasMeaningfulValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

export const stageHasOwnedData = (deal: Partial<Deal> | null | undefined, stage: DealStage): boolean => {
  if (!deal) return false;
  return getStageOwnedFields(stage).some((field) => hasMeaningfulValue((deal as any)[field]));
};

/**
 * Stages whose data is at risk during a backward move: pipeline stages strictly
 * between `targetStage` and `currentStage`, plus the current terminal/pause
 * stage when rolling back from Won/Lost/Hold/Dropped into the active pipeline.
 */
export const getStagesBetween = (targetStage: DealStage, currentStage: DealStage): DealStage[] => {
  const fromIdx = PIPELINE_STAGES.indexOf(targetStage);
  const toIdx = PIPELINE_STAGES.indexOf(currentStage);
  if (fromIdx < 0) return [];
  if (toIdx < 0) {
    if (!TERMINAL_STAGES.includes(currentStage)) return [];
    return [...PIPELINE_STAGES.slice(fromIdx + 1), currentStage];
  }
  if (toIdx <= fromIdx) return [];
  return PIPELINE_STAGES.slice(fromIdx + 1, toIdx + 1);
};

export const getBackwardAffectedStages = (
  currentStage: DealStage,
  targetStage: DealStage,
  deal?: Partial<Deal> | null,
): DealStage[] => {
  const baseline = getStagesBetween(targetStage, currentStage);
  if (!deal) return baseline;

  const targetIdx = PIPELINE_STAGES.indexOf(targetStage);
  if (targetIdx < 0) return baseline;

  const affected = new Set<DealStage>(baseline);

  // If a deal has been moved back once with data kept, later-stage fields can
  // remain populated even though the current stage is already earlier. Include
  // those populated future stages so a later "clear" decision actually cleans
  // all stale stage-owned data beyond the target.
  for (const stage of PIPELINE_STAGES.slice(targetIdx + 1)) {
    if (stageHasOwnedData(deal, stage)) affected.add(stage);
  }
  for (const stage of TERMINAL_STAGES) {
    if (stage === currentStage || stageHasOwnedData(deal, stage)) affected.add(stage);
  }

  return [...PIPELINE_STAGES.slice(targetIdx + 1), ...TERMINAL_STAGES].filter((stage) => affected.has(stage));
};

/**
 * Build a clear-payload that nulls out every field owned by stages being
 * unwound during a backward move.
 */
export const buildClearPayloadForBackwardMove = (
  targetStage: DealStage,
  currentStage: DealStage,
  deal?: Partial<Deal> | null,
): Partial<Deal> => {
  const affected = getBackwardAffectedStages(currentStage, targetStage, deal);
  const payload: Record<string, null> = {};
  for (const s of affected) {
    for (const f of getStageOwnedFields(s)) {
      payload[f as string] = null;
    }
  }
  return payload as Partial<Deal>;
};

export const buildBackwardMoveUpdates = (
  currentStage: DealStage,
  targetStage: DealStage,
  choice: 'keep' | 'clear' = 'keep',
  deal?: Partial<Deal> | null,
): Partial<Deal> => ({
  ...(choice === 'clear' ? buildClearPayloadForBackwardMove(targetStage, currentStage, deal) : {}),
  stage: targetStage,
  probability: STAGE_PROBABILITY[targetStage],
});
