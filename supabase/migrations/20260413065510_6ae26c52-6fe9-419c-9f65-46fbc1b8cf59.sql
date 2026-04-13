
DO $$
DECLARE
  v_campaign_id uuid := gen_random_uuid();
  v_user_id uuid := 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff';
  v_account1 uuid := '28874826-cd55-4f82-87f3-646f5b3bb55f'; -- KICKERT
  v_account2 uuid := '50386497-ab54-4751-ade8-a549270f235c'; -- Leoni
  v_contact1 uuid := '85e76fb4-7fa9-47ef-8ee1-430f81890574'; -- Hannafia
  v_contact2 uuid := 'ffa147ed-cd9b-4367-9fe3-eb4cd4b39af9'; -- Markus Hoermann
  v_contact3 uuid := 'a64f068e-4b53-4c53-a2cf-f7dab106a947'; -- Markus Kohler
BEGIN
  -- Campaign
  INSERT INTO public.campaigns (id, campaign_name, campaign_type, status, start_date, end_date, owner, created_by, goal, description, region, country, target_audience, message_strategy)
  VALUES (v_campaign_id, 'E2E Full Test - Medical Devices Q3 2026', 'Cold Outreach', 'Draft', '2026-07-01', '2026-09-30', v_user_id, v_user_id,
    'Generate 10 qualified leads from medical device manufacturers in DACH region',
    'Outreach campaign targeting medical device OEMs for sensor integration partnerships',
    'Europe', 'Germany', 'VP Engineering, R&D Directors at medical device OEMs',
    'Lead with compliance expertise (MDR/ISO 13485), follow up with case studies');

  -- MART (all false)
  INSERT INTO public.campaign_mart (campaign_id) VALUES (v_campaign_id);

  -- Campaign Accounts
  INSERT INTO public.campaign_accounts (campaign_id, account_id, status, created_by) VALUES
    (v_campaign_id, v_account1, 'Not Contacted', v_user_id),
    (v_campaign_id, v_account2, 'Not Contacted', v_user_id);

  -- Campaign Contacts
  INSERT INTO public.campaign_contacts (campaign_id, contact_id, account_id, stage, linkedin_status, created_by) VALUES
    (v_campaign_id, v_contact1, v_account1, 'Not Contacted', 'Not Contacted', v_user_id),
    (v_campaign_id, v_contact2, v_account1, 'Not Contacted', 'Not Contacted', v_user_id),
    (v_campaign_id, v_contact3, v_account2, 'Email Sent', 'Connection Sent', v_user_id);

  -- Email Templates
  INSERT INTO public.campaign_email_templates (campaign_id, template_name, subject, body, email_type, audience_segment, created_by) VALUES
    (v_campaign_id, 'Initial Outreach', 'Sensor Integration for Medical Devices', 'Dear {{contact_name}},\n\nWe specialize in precision sensors for medical devices...', 'Initial', 'VP Engineering', v_user_id),
    (v_campaign_id, 'Follow-up', 'Following up on sensor partnership', 'Hi {{contact_name}},\n\nI wanted to follow up on my previous email...', 'Follow-up', 'All', v_user_id);

  -- Phone Script
  INSERT INTO public.campaign_phone_scripts (campaign_id, script_name, opening_script, key_talking_points, discovery_questions, objection_handling, audience_segment, created_by) VALUES
    (v_campaign_id, 'Discovery Call Script', 'Hi, this is [name] from [company]. I noticed you are working on...', 'MDR compliance expertise\nISO 13485 certified\n5+ year sensor lifespan', 'What sensor challenges are you facing?\nWhat is your timeline for next-gen devices?', 'We handle all regulatory documentation\nOur sensors have proven 99.9% reliability', 'R&D Directors', v_user_id);

  -- Communications (Email, Call, LinkedIn)
  INSERT INTO public.campaign_communications (campaign_id, contact_id, account_id, communication_type, subject, body, email_type, email_status, owner, created_by) VALUES
    (v_campaign_id, v_contact3, v_account2, 'Email', 'Sensor Integration for Medical Devices', 'Initial outreach email sent', 'Initial', 'Sent', v_user_id, v_user_id);

  INSERT INTO public.campaign_communications (campaign_id, contact_id, account_id, communication_type, call_outcome, notes, owner, created_by) VALUES
    (v_campaign_id, v_contact1, v_account1, 'Call', 'Voicemail', 'Left voicemail, will follow up next week', v_user_id, v_user_id);

  INSERT INTO public.campaign_communications (campaign_id, contact_id, account_id, communication_type, linkedin_status, notes, owner, created_by) VALUES
    (v_campaign_id, v_contact2, v_account1, 'LinkedIn', 'Connection Sent', 'Sent connection request with note about sensor expertise', v_user_id, v_user_id);
END $$;
