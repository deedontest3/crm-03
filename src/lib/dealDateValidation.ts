import { parseDealDate, formatDealDate } from "@/lib/dealDate";

const FIELD_LABELS: Record<string, string> = {
  signed_contract_date: "Signed Contract Date",
  implementation_start_date: "Project Start Date",
  start_date: "Project Start Date",
  end_date: "Project End Date",
  expected_closing_date: "Target Closure date",
  rfq_received_date: "RFQ Received Date",
  proposal_due_date: "Submission Date",
  expected_signing_date: "Expected PO Signing Date",
  verbal_approval_date: "Verbal Approval Date",
  revise_date: "Revise Date",
  next_step_due_date: "Next Step date",
};

/**
 * Ordering edges: each pair means `from` date must be on or before `to` date.
 * Branching is allowed (one field can have multiple predecessors / successors).
 * Edges are only enforced when BOTH dates are present on the form.
 */
const DATE_ORDER_EDGES: ReadonlyArray<readonly [string, string]> = [
  // RFQ cycle
  ["rfq_received_date", "proposal_due_date"],
  ["rfq_received_date", "expected_closing_date"],
  ["proposal_due_date", "expected_closing_date"],
  ["proposal_due_date", "start_date"],
  ["expected_closing_date", "start_date"],
  // Pre-Won project window
  ["start_date", "end_date"],
  // Won execution: Signed Contract → Project Start → Project End
  ["signed_contract_date", "implementation_start_date"],
  ["implementation_start_date", "end_date"],
];

const ALL_FIELDS: ReadonlySet<string> = new Set(
  DATE_ORDER_EDGES.flatMap(([a, b]) => [a, b])
);

type DealLike = Record<string, any>;

/**
 * Validate a single date field against every edge that touches it.
 * Returns the first error string, or undefined when valid.
 */
export function validateDealDateField(
  field: string,
  nextValue: any,
  form: DealLike
): string | undefined {
  if (!ALL_FIELDS.has(field)) return undefined;

  const current = parseDealDate(nextValue);
  if (!current) return undefined;

  // Predecessors: every edge ending at `field` — current must be >= predecessor.
  for (const [from, to] of DATE_ORDER_EDGES) {
    if (to !== field) continue;
    const prev = parseDealDate(form[from]);
    if (prev && current < prev) {
      return `Must be on or after ${FIELD_LABELS[from] ?? from} (${formatDealDate(form[from])}).`;
    }
  }

  // Successors: every edge starting at `field` — current must be <= successor.
  for (const [from, to] of DATE_ORDER_EDGES) {
    if (from !== field) continue;
    const next = parseDealDate(form[to]);
    if (next && current > next) {
      return `Must be on or before ${FIELD_LABELS[to] ?? to} (${formatDealDate(form[to])}).`;
    }
  }

  return undefined;
}

/**
 * After a date field changes, compute live errors for that field AND its
 * neighbours (so fixing one clears stale errors on the others).
 */
export function recomputeDateErrors(form: DealLike): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of ALL_FIELDS) {
    const err = validateDealDateField(field, form[field], form);
    if (err) errors[field] = err;
  }
  return errors;
}

export const DEAL_DATE_FIELDS = ALL_FIELDS;

/**
 * Compute the inclusive min/max bounds for a date field based on the current
 * sibling values in the form. Used to grey out invalid days in the calendar.
 */
export function getDateBounds(
  field: string,
  form: DealLike
): { min?: Date; max?: Date } {
  if (!ALL_FIELDS.has(field)) return {};
  let min: Date | undefined;
  let max: Date | undefined;

  for (const [from, to] of DATE_ORDER_EDGES) {
    if (to === field) {
      const prev = parseDealDate(form[from]);
      if (prev && (!min || prev > min)) min = prev;
    }
    if (from === field) {
      const next = parseDealDate(form[to]);
      if (next && (!max || next < max)) max = next;
    }
  }
  return { min, max };
}

