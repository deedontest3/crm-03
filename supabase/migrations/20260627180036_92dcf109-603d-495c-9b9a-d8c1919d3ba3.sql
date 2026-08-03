
CREATE OR REPLACE FUNCTION public.validate_deal_business_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  today date := CURRENT_DATE;
  open_stages text[] := ARRAY['Lead','Discussions','Qualified','RFQ','Offered','Verbal Approval'];
  post_lead_stages text[] := ARRAY['Discussions','Qualified','RFQ','Offered','Negotiation','Verbal Approval','Won'];
  post_discussions_open text[] := ARRAY['Qualified','RFQ','Offered','Negotiation','Verbal Approval'];
  competitor_stages text[] := ARRAY['Negotiation','Verbal Approval','Won'];
BEGIN
  IF NEW.signed_contract_date IS NOT NULL AND NEW.signed_contract_date > today THEN
    RAISE EXCEPTION 'Signed contract date cannot be in the future';
  END IF;

  IF NEW.stage = ANY(post_lead_stages)
     AND (NEW.bu IS NULL OR array_length(NEW.bu, 1) IS NULL) THEN
    RAISE EXCEPTION 'Business Unit (BU) is required before moving past Lead';
  END IF;

  -- Exit-based: next_step is required only once the deal has moved PAST Discussions.
  IF NEW.stage = ANY(post_discussions_open)
     AND (NEW.next_step IS NULL OR btrim(NEW.next_step) = '') THEN
    RAISE EXCEPTION 'Next Step is required from Qualified onward';
  END IF;

  IF NEW.stage = ANY(open_stages)
     AND NEW.next_step IS NOT NULL AND btrim(NEW.next_step) <> ''
     AND NEW.next_step_due_date IS NOT NULL
     AND NEW.next_step_due_date < today THEN
    RAISE EXCEPTION 'Next Step Due Date must be today or later';
  END IF;

  IF NEW.stage = ANY(competitor_stages)
     AND COALESCE(NEW.competition, '') = 'Yes'
     AND (NEW.competitors IS NULL OR btrim(NEW.competitors) = '') THEN
    RAISE EXCEPTION 'Competitors are required when competition is Yes';
  END IF;

  IF NEW.stage = 'Hold'
     AND NEW.revise_date IS NOT NULL
     AND NEW.revise_date <= today THEN
    RAISE EXCEPTION 'Revise Date must be in the future';
  END IF;

  IF NEW.stage = 'Verbal Approval'
     AND NEW.expected_signing_date IS NOT NULL
     AND COALESCE(NEW.po_status, '') <> 'Received'
     AND NEW.expected_signing_date < today THEN
    RAISE EXCEPTION 'Expected PO Signing Date must be today or later until PO is Received';
  END IF;

  IF NEW.rfq_received_date IS NOT NULL
     AND NEW.proposal_due_date IS NOT NULL
     AND NEW.proposal_due_date < NEW.rfq_received_date THEN
    RAISE EXCEPTION 'Submission Date must be on or after RFQ Received Date';
  END IF;

  IF NEW.stage = ANY(open_stages)
     AND NEW.expected_closing_date IS NOT NULL
     AND NEW.expected_closing_date < today THEN
    RAISE EXCEPTION 'Target Closure Date must be today or later for open stages';
  END IF;

  IF NEW.expected_closing_date IS NOT NULL
     AND NEW.proposal_due_date IS NOT NULL
     AND NEW.expected_closing_date < NEW.proposal_due_date THEN
    RAISE EXCEPTION 'Target Closure Date must be on or after Submission Date';
  END IF;

  IF NEW.stage = 'Verbal Approval'
     AND NEW.implementation_start_date IS NOT NULL
     AND NEW.expected_signing_date IS NOT NULL
     AND NEW.implementation_start_date < NEW.expected_signing_date THEN
    RAISE EXCEPTION 'Project Start Date must be on or after Expected PO Signing Date';
  END IF;

  IF NEW.stage = 'Won'
     AND NEW.signed_contract_date IS NOT NULL
     AND NEW.rfq_received_date IS NOT NULL
     AND NEW.signed_contract_date < NEW.rfq_received_date THEN
    RAISE EXCEPTION 'Signed Contract Date must be on or after RFQ Received Date';
  END IF;

  IF NEW.start_date IS NOT NULL
     AND NEW.end_date IS NOT NULL
     AND NEW.end_date < NEW.start_date THEN
    RAISE EXCEPTION 'Project End Date must be on or after Project Start Date';
  END IF;

  IF NEW.signed_contract_date IS NOT NULL
     AND NEW.implementation_start_date IS NOT NULL
     AND NEW.implementation_start_date < NEW.signed_contract_date THEN
    RAISE EXCEPTION 'Project Start Date must be on or after Signed Contract Date';
  END IF;

  RETURN NEW;
END;
$$;
