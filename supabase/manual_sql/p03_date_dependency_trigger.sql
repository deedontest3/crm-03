-- P0.3 — Date dependency trigger
-- Mirrors the client-side rules in src/components/deal-form/validation.ts::validateDateLogic
-- so direct SQL writes and CSV imports cannot bypass them.
-- Run this once the `public.deals` table is present.

CREATE OR REPLACE FUNCTION public.validate_deal_date_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  today date := CURRENT_DATE;
  open_stages text[] := ARRAY['Lead','Discussions','Qualified','RFQ','Offered','Verbal Approval'];
BEGIN
  -- Hold: revise_date must be strictly in the future
  IF NEW.stage = 'Hold'
     AND NEW.revise_date IS NOT NULL
     AND NEW.revise_date <= today THEN
    RAISE EXCEPTION 'Revise Date must be in the future';
  END IF;

  -- Verbal Approval: expected_signing_date >= today while PO not Received
  IF NEW.stage = 'Verbal Approval'
     AND NEW.expected_signing_date IS NOT NULL
     AND COALESCE(NEW.po_status, '') <> 'Received'
     AND NEW.expected_signing_date < today THEN
    RAISE EXCEPTION 'Expected PO Signing Date must be today or later until PO is Received';
  END IF;

  -- RFQ: proposal_due_date >= rfq_received_date
  IF NEW.rfq_received_date IS NOT NULL
     AND NEW.proposal_due_date IS NOT NULL
     AND NEW.proposal_due_date < NEW.rfq_received_date THEN
    RAISE EXCEPTION 'Submission Date must be on or after RFQ Received Date';
  END IF;

  -- Any open stage: expected_closing_date >= today
  IF NEW.stage = ANY(open_stages)
     AND NEW.expected_closing_date IS NOT NULL
     AND NEW.expected_closing_date < today THEN
    RAISE EXCEPTION 'Target Closure Date must be today or later for open stages';
  END IF;

  -- expected_closing_date >= proposal_due_date when both set
  IF NEW.expected_closing_date IS NOT NULL
     AND NEW.proposal_due_date IS NOT NULL
     AND NEW.expected_closing_date < NEW.proposal_due_date THEN
    RAISE EXCEPTION 'Target Closure Date must be on or after Submission Date';
  END IF;

  -- Verbal Approval: implementation_start_date >= expected_signing_date
  IF NEW.stage = 'Verbal Approval'
     AND NEW.implementation_start_date IS NOT NULL
     AND NEW.expected_signing_date IS NOT NULL
     AND NEW.implementation_start_date < NEW.expected_signing_date THEN
    RAISE EXCEPTION 'Project Start Date must be on or after Expected PO Signing Date';
  END IF;

  -- Won: signed_contract_date >= rfq_received_date
  IF NEW.stage = 'Won'
     AND NEW.signed_contract_date IS NOT NULL
     AND NEW.rfq_received_date IS NOT NULL
     AND NEW.signed_contract_date < NEW.rfq_received_date THEN
    RAISE EXCEPTION 'Signed Contract Date must be on or after RFQ Received Date';
  END IF;

  -- Generic ordering: end_date >= start_date
  IF NEW.start_date IS NOT NULL
     AND NEW.end_date IS NOT NULL
     AND NEW.end_date < NEW.start_date THEN
    RAISE EXCEPTION 'Project End Date must be on or after Project Start Date';
  END IF;

  -- Generic ordering: implementation_start_date >= signed_contract_date
  IF NEW.signed_contract_date IS NOT NULL
     AND NEW.implementation_start_date IS NOT NULL
     AND NEW.implementation_start_date < NEW.signed_contract_date THEN
    RAISE EXCEPTION 'Project Start Date must be on or after Signed Contract Date';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_deal_date_rules_trigger ON public.deals;
CREATE TRIGGER validate_deal_date_rules_trigger
  BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_deal_date_rules();
