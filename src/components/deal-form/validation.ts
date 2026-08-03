import { Deal, DealStage, getRequiredFieldsForStage } from "@/types/deal";
import {
  getRevenueWindow,
  reconcileTCV,
  getOrphanedCells,
  monthsBetween,
  ScheduleCell,
} from "@/lib/revenueSchedule";
import { formatCalendarQuarter } from "@/lib/fiscalYear";
import { recomputeDateErrors } from "@/lib/dealDateValidation";


// Human-readable labels for required-field errors.
const FIELD_LABELS: Record<string, string> = {
  project_name: 'Project Name',
  lead_name: 'Lead Name',
  customer_name: 'Customer Name',
  account_id: 'Account',
  region: 'Region',
  lead_owner: 'Lead Owner',
  priority: 'Priority',
  customer_need: 'Customer Need',
  relationship_strength: 'Relationship Strength',
  internal_comment: 'Internal Comment',
  customer_challenges: 'Customer Challenges',
  current_solution: 'Current Solution',
  budget: 'Amount (Budget)',
  probability: 'Probability',
  expected_closing_date: 'Target Closure date',
  is_recurring: 'Recurring',
  total_contract_value: 'Total Contract Value',
  currency_type: 'Currency',
  start_date: 'Contract Project Start Date',
  end_date: 'Project End Date',
  rfq_received_date: 'RFQ Received Date',
  proposal_due_date: 'Submission Date',
  rfq_status: 'RFQ Status',
  action_items: 'Action Items',
  business_value: 'Business Value',
  decision_maker_level: 'Decision Maker Level',
  current_status: 'Current Status',
  closing: 'Closing',
  po_status: 'PO Status',
  expected_signing_date: 'Expected PO Signing Date',
  verbal_approval_date: 'Verbal Approval Date',
  hold_reason: 'Reason for Hold',
  revise_date: 'Revise Date',
  implementation_start_date: 'Implementation Start Date',
  customer_objection: 'Customer Objection',
  competition: 'Competition',
  competitors: 'Competitors',
  final_tcv: 'Final TCV',
  opportunity_summary: 'Opportunity Summary',
  opportunity_description: 'Opportunity Description',
  won_reason: 'Won Reason',
  total_revenue: 'Total Revenue',
  signed_contract_date: 'Signed Contract Date',
  handoff_status: 'Handoff Status',
  po_number: 'PO Number',
  lost_reason: 'Lost Reason',
  drop_reason: 'Drop Reason',
  bu: 'Business Unit (BU)',
  next_step: 'Next Step',
  next_step_due_date: 'Next Step date',
};


const isEmpty = (v: unknown): boolean => {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
};

/**
 * Validates that all stage-required fields are filled.
 * Returns a map of field -> human-readable error message.
 * `competitor_name` is conditionally required only when `competitor_involved === 'Yes'`.
 */
export const getFieldErrors = (
  formData?: Partial<Deal>,
  stage?: DealStage,
  opts: { hasRfqSubmittedDocument?: boolean } = {}
): Record<string, string> => {
  if (!formData) return {};
  const s = (stage || formData.stage || 'Lead') as DealStage;
  const required = getRequiredFieldsForStage(s);
  const errors: Record<string, string> = {};

  for (const field of required) {
    if (isEmpty((formData as any)[field])) {
      const label = FIELD_LABELS[field] || field;
      errors[field] = `${label} is required`;
    }
  }

  // Lead-stage account integrity: a deal must be linked to a real Account
  // (account_id) — free-text customer_name alone risks orphan deals.
  if (s === 'Lead') {
    if (isEmpty((formData as any).account_id)) {
      errors.account_id =
        'Select an Account from the list (free-text alone is not allowed).';
      // Surface against customer_name too so the field highlights in the form.
      if (!errors.customer_name) {
        errors.customer_name = 'Select an Account from the list.';
      }
    }
  }

  // P0.2 — competition=Yes ⇒ competitors required for late stages.
  const competitorStages: DealStage[] = ['Negotiation', 'Verbal Approval', 'Won'];
  if (
    competitorStages.includes(s) &&
    (formData as any).competition === 'Yes' &&
    isEmpty((formData as any).competitors)
  ) {
    errors.competitors = 'Competitors are required when competition is Yes.';
  }

  // hold_reason must match the DB enum constraint (deals_hold_reason_check).
  const HOLD_REASONS = ['Budget Freeze', 'Project Delayed', 'Waiting Approval', 'Procurement Delay', 'Technical Review', 'Resource Constraint', 'Customer Request', 'Other'];
  const hr = (formData as any).hold_reason;
  if (!isEmpty(hr) && !HOLD_REASONS.includes(String(hr))) {
    errors.hold_reason = `Reason for Hold must be one of: ${HOLD_REASONS.join(', ')}.`;
  }

  // Budget + currency are merged into a single "Amount" control on Qualified+.
  // When a budget is provided, the matching currency must be set, and the
  // amount must parse to a positive number.
  const budgetRaw = (formData as any).budget;
  if (!isEmpty(budgetRaw)) {
    const cleaned = String(budgetRaw).replace(/[^0-9.\-]/g, '');
    const n = Number(cleaned);
    if (!cleaned || !Number.isFinite(n) || n <= 0) {
      errors.budget = 'Amount must be a positive number.';
    }
    if (isEmpty((formData as any).currency_type)) {
      errors.currency_type = 'Currency is required when Amount is set.';
    }
  }

  // RFQ-and-later: Total Contract Value must be > 0.
  const tcvGatedStages: DealStage[] = ['RFQ', 'Offered', 'Negotiation', 'Verbal Approval', 'Won'];
  if (tcvGatedStages.includes(s)) {
    const tcvNum = Number((formData as any).total_contract_value);
    if (!errors.total_contract_value && (!Number.isFinite(tcvNum) || tcvNum <= 0)) {
      errors.total_contract_value = 'Total Contract Value must be greater than 0.';
    }
  }

  // RFQ: when status is Submitted, an uploaded RFQ/Proposal document is required.
  if (s === 'RFQ' && (formData as any).rfq_status === 'Submitted' && opts.hasRfqSubmittedDocument === false) {
    errors.rfq_status = 'Attach the submitted RFQ/Proposal in Documents below — upload a file or add a document link.';
  }

  // L8 — RFQ Rejected requires a lost_reason capture before saving.
  if (s === 'RFQ' && (formData as any).rfq_status === 'Rejected' && isEmpty((formData as any).lost_reason)) {
    errors.lost_reason = 'Lost Reason is required when RFQ Status is Rejected.';
  }

  // Negotiation: final_tcv must be > 0 and within a reasonable band of TCV.
  if (s === 'Negotiation' || s === 'Verbal Approval' || s === 'Won') {
    const ftvRaw = (formData as any).final_tcv;
    if (!isEmpty(ftvRaw)) {
      const ftv = Number(ftvRaw);
      if (!Number.isFinite(ftv) || ftv <= 0) {
        errors.final_tcv = 'Final TCV must be greater than 0.';
      } else {
        const tcv = Number((formData as any).total_contract_value) || 0;
        if (tcv > 0 && Math.abs(ftv - tcv) / tcv > 0.5) {
          errors.final_tcv = 'Final TCV differs from TCV by more than 50% — review before saving.';
        }
      }
    } else if (s === 'Negotiation') {
      // already covered by required-field loop, keep no-op
    }
  }

  return errors;
};


export const validateRequiredFields = (
  formData?: Partial<Deal>,
  stage?: DealStage
): boolean => Object.keys(getFieldErrors(formData, stage)).length === 0;

export const validateField = (
  _field?: string,
  value?: unknown,
  required: boolean = false
): boolean => !(required && isEmpty(value));


import { parseDealDate } from "@/lib/dealDate";

const toDate = (v: unknown): Date | null => {
  // Delegate to the shared parser so bare `yyyy-MM-dd` strings anchor at local
  // midnight (matching the app's other date UI) instead of UTC midnight, which
  // caused off-by-one validation errors in negative-UTC timezones.
  return parseDealDate(v);
};





export const validateDateLogic = (
  formData?: Partial<Deal>
): { isValid: boolean; error?: string; fieldErrors?: Record<string, string> } => {
  if (!formData) return { isValid: true };
  // Start with centralized cross-field date-order errors so the save-path
  // enforces the same rules as the calendar's disabled-day bounds.
  const fieldErrors: Record<string, string> = {
    ...recomputeDateErrors(formData as Record<string, any>),
  };
  const stage = formData.stage as DealStage | undefined;


  const start = toDate(formData.start_date);
  const end = toDate(formData.end_date);
  const signed = toDate(formData.signed_contract_date);
  const impl = toDate(formData.implementation_start_date);
  const expSign = toDate(formData.expected_signing_date);
  const rfqRecv = toDate((formData as any).rfq_received_date);
  const propDue = toDate((formData as any).proposal_due_date);
  const expClose = toDate(formData.expected_closing_date);
  const verbalApproval = toDate((formData as any).verbal_approval_date);

  if (verbalApproval && expSign && expSign < verbalApproval) {
    fieldErrors.expected_signing_date =
      'Expected PO Signing Date must be on or after Verbal Approval Date.';
  }

  // Existing rules
  if (start && end && start > end) {
    fieldErrors.end_date = 'Project End Date must be on or after Contract Project Start Date.';
  }
  if (signed && impl && signed > impl) {
    fieldErrors.implementation_start_date =
      'Implementation Start Date must be on or after Signed Contract Date.';
  }
  // L14 — Contract Project Start Date (RFQ) must be on or before Implementation Start Date (VA/Won).
  if (start && impl && start > impl) {
    fieldErrors.implementation_start_date =
      'Implementation Start Date must be on or after Contract Project Start Date.';
  }

  // Note: calendar-position rules ("must be today or later", "cannot be in the
  // past/future") were intentionally removed — deals are frequently back-dated
  // or planned ahead. Only relationship/ordering rules remain below.

  if (rfqRecv && propDue && propDue < rfqRecv) {
    fieldErrors.proposal_due_date = 'Submission Date must be on or after RFQ Received Date.';
  }

  if (expClose && propDue && expClose < propDue) {
    fieldErrors.expected_closing_date =
      'Target Closure date must be on or after Submission Date.';
  }


  // L16 — Next Step date should not exceed Target Closure date.
  const nextStepDue = toDate((formData as any).next_step_due_date);
  if (nextStepDue && expClose && nextStepDue > expClose) {
    fieldErrors.next_step_due_date =
      'Next Step date is after Target Closure date — review the plan.';
  }

  if (stage === 'Verbal Approval' && impl && expSign && impl < expSign) {
    fieldErrors.implementation_start_date =
      'Project Start Date must be on or after Expected PO Signing Date.';
  }

  if (stage === 'Won' && signed && rfqRecv && signed < rfqRecv) {
    fieldErrors.signed_contract_date =
      'Signed Contract Date must be on or after RFQ Received Date.';
  }

  const keys = Object.keys(fieldErrors);
  if (keys.length === 0) return { isValid: true };
  // Date ordering issues are advisory only — they are surfaced inline next to
  // the field as you pick a date, but they never block saving.
  return { isValid: true, error: fieldErrors[keys[0]], fieldErrors };
};

export const validateRevenueSum = (
  formData?: Partial<Deal>,
  schedule: ScheduleCell[] = []
): { isValid: boolean; error?: string } => {
  if (!formData) return { isValid: true };
  const tcv = Number(formData.total_contract_value) || 0;
  if (tcv <= 0) return { isValid: true };
  const sum = schedule.reduce((a, c) => a + (Number(c.revenue) || 0), 0);
  const recon = reconcileTCV(sum, tcv);
  if (recon.state === 'over' && recon.deltaPct > 5) {
    return { isValid: false, error: `Schedule exceeds TCV by ${recon.deltaPct.toFixed(1)}%.` };
  }
  return { isValid: true };
};

export interface WonValidationResult {
  errors: string[];
  warnings: string[];
}

/**
 * Validates the Won stage's contract + revenue schedule.
 * - errors  → must block save
 * - warnings → soft-confirm before save
 */
export const validateWonStage = (
  formData: Partial<Deal>,
  schedule: ScheduleCell[],
  opts: { hasSignedContractDocument?: boolean } = {}
): WonValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- Required fields ---
  // L13: implementation_start_date is enforced by getRequiredFieldsForStage('Won').
  if (!formData.end_date && !formData.project_duration)
    errors.push("Either End Date or Project Duration is required.");

  // P0.2 — competition=Yes ⇒ competitors required at Won
  if (
    (formData as any).competition === 'Yes' &&
    isEmpty((formData as any).competitors)
  ) {
    errors.push('Competitors are required when competition is Yes.');
  }

  // P1.9 — Won closing requirements


  // --- Date ordering ---
  const signed = formData.signed_contract_date ? new Date(formData.signed_contract_date) : null;
  const impl = formData.implementation_start_date
    ? new Date(formData.implementation_start_date)
    : null;
  const end = formData.end_date ? new Date(formData.end_date) : null;

  if (signed && impl && signed > impl)
    errors.push("Implementation Start Date must be on or after Signed Contract Date.");
  if (impl && end && impl > end)
    errors.push("End Date must be on or after Implementation Start Date.");

  // --- Project duration auto-derive mismatch ---
  if (formData.implementation_start_date && formData.end_date && formData.project_duration) {
    const derived = monthsBetween(formData.implementation_start_date, formData.end_date);
    if (derived > 0 && Math.abs(derived - formData.project_duration) >= 2) {
      warnings.push(
        `Project Duration (${formData.project_duration}m) doesn't match start/end span (${derived}m).`
      );
    }
  }

  // --- Schedule sanity ---
  const window = getRevenueWindow(formData);
  if (window.start && window.end) {
    const spanYears = window.end.year - window.start.year + 1;
    if (spanYears > 8) warnings.push(`Contract spans ${spanYears} years — double-check dates.`);
  }

  for (const c of schedule) {
    if (c.revenue < 0) errors.push(`${formatCalendarQuarter(c.year, c.quarter)} revenue cannot be negative.`);
    if (c.revenue > 9_999_999_999)
      errors.push(`${formatCalendarQuarter(c.year, c.quarter)} revenue exceeds maximum allowed.`);
  }

  // Orphaned schedule cells (outside contract window, non-zero)
  const orphans = getOrphanedCells(schedule, window);
  if (orphans.length > 0) {
    warnings.push(
      `${orphans.length} quarter(s) have revenue outside the contract window — review or clear them.`
    );
  }

  // --- TCV reconciliation ---
  const tcv = Number(formData.total_contract_value) || 0;
  const sum = schedule.reduce((a, c) => a + (Number(c.revenue) || 0), 0);

  // HARD ERROR: Won deal with TCV but zero schedule rows / zero allocated revenue.
  if (tcv > 0 && (schedule.length === 0 || sum === 0)) {
    errors.push(
      "Won deal has a Total Contract Value but no revenue allocated — fill in the quarterly revenue schedule before saving."
    );
  }

  const recon = reconcileTCV(sum, formData.total_contract_value);
  if (recon.state === 'over' && recon.deltaPct > 5) {
    warnings.push(
      `Revenue schedule exceeds TCV by ${recon.deltaPct.toFixed(1)}% (${recon.deltaAbs.toFixed(0)}).`
    );
  } else if (recon.state === 'under' && recon.deltaPct > 5 && sum > 0) {
    warnings.push(
      `Revenue schedule is ${recon.deltaPct.toFixed(1)}% below TCV (${recon.deltaAbs.toFixed(0)} unallocated).`
    );
  }

  // --- Backdated revenue ---
  const today = new Date();
  for (const c of schedule) {
    if (c.revenue > 0 && today.getFullYear() - c.year > 5) {
      warnings.push(`${formatCalendarQuarter(c.year, c.quarter)} is more than 5 years in the past — confirm.`);
      break;
    }
  }

  return { errors, warnings };
};

export const shouldValidateWon = (stage: DealStage): boolean => stage === 'Won';
