
-- Seed E2E test campaign data
-- User: Deepak Dongare = c9ae71ae-86b7-4467-a1b6-0b86bf38adff
-- Accounts: Claas = 3a476ca0-b553-4422-a405-4a6332239578, Keboda = 260b1313-2785-4e98-baa0-c6223d2cd662
-- Contacts: Markus Kohler = a64f068e-4b53-4c53-a2cf-f7dab106a947, Axel Benz = 09694a49-8178-43c5-92df-25ff418afdbf, Athar Khan = 1adb4b2c-f3bf-4282-9e4f-3b791740e0d0

DO $$
DECLARE
  v_user_id uuid := 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff';
  v_campaign_id uuid := gen_random_uuid();
  v_claas uuid := '3a476ca0-b553-4422-a405-4a6332239578';
  v_keboda uuid := '260b1313-2785-4e98-baa0-c6223d2cd662';
  v_markus uuid := 'a64f068e-4b53-4c53-a2cf-f7dab106a947';
  v_axel uuid := '09694a49-8178-43c5-92df-25ff418afdbf';
  v_athar uuid := '1adb4b2c-f3bf-4282-9e4f-3b791740e0d0';
BEGIN
  -- 1. Campaign
  INSERT INTO campaigns (id, campaign_name, campaign_type, goal, owner, start_date, end_date, status, description, region, country, target_audience, message_strategy, created_by)
  VALUES (v_campaign_id, 'E2E Test - Automotive Sensor Q4 Campaign', 'Cold Outreach', 'Generate 15 qualified leads from automotive sensor companies in DACH region', v_user_id, '2026-10-01', '2026-12-31', 'Draft', 'End-to-end test campaign targeting automotive sensor manufacturers for Q4 outreach.', 'Europe', 'Germany', 'Engineering managers and procurement heads at Tier-1 automotive sensor suppliers', 'Position our sensing solutions as cost-effective alternatives with faster lead times and local support.', v_user_id);

  -- 2. MART row (all flags false)
  INSERT INTO campaign_mart (campaign_id) VALUES (v_campaign_id);

  -- 3. Campaign accounts
  INSERT INTO campaign_accounts (campaign_id, account_id, status, created_by) VALUES
    (v_campaign_id, v_claas, 'Not Contacted', v_user_id),
    (v_campaign_id, v_keboda, 'Not Contacted', v_user_id);

  -- 4. Campaign contacts
  INSERT INTO campaign_contacts (campaign_id, contact_id, account_id, stage, linkedin_status, created_by) VALUES
    (v_campaign_id, v_markus, v_claas, 'Not Contacted', 'Not Contacted', v_user_id),
    (v_campaign_id, v_axel, v_claas, 'Not Contacted', 'Not Contacted', v_user_id),
    (v_campaign_id, v_athar, v_keboda, 'Not Contacted', 'Not Contacted', v_user_id);

  -- 5. Email templates
  INSERT INTO campaign_email_templates (campaign_id, template_name, subject, body, email_type, audience_segment, created_by) VALUES
    (v_campaign_id, 'Initial Outreach - Engineering', 'Exploring sensing solutions for your automotive platform', 'Dear {{contact_name}},\n\nI noticed {{company_name}} is expanding its sensor portfolio. We offer cost-effective alternatives with faster lead times.\n\nWould you be open to a brief call next week?\n\nBest regards', 'Cold Outreach', 'Engineering Managers', v_user_id),
    (v_campaign_id, 'Follow-up - Procurement', 'Quick follow-up: Sensor supply partnership', 'Hi {{contact_name}},\n\nFollowing up on my earlier email. We have successfully partnered with several Tier-1 suppliers in the DACH region.\n\nI would love to share some case studies relevant to {{company_name}}.\n\nBest regards', 'Follow-up', 'Procurement Heads', v_user_id);

  -- 6. Phone script
  INSERT INTO campaign_phone_scripts (campaign_id, script_name, opening_script, key_talking_points, discovery_questions, objection_handling, audience_segment, created_by) VALUES
    (v_campaign_id, 'Engineering Manager Call Script', 'Hi, this is [Name] from [Company]. I am reaching out because we work with several automotive sensor companies in the DACH region...', '• Cost savings of 15-20% vs current suppliers\n• Local warehousing in Germany\n• ISO/IATF certified production', '1. What sensing technologies are you currently evaluating?\n2. What are your biggest supply chain challenges?\n3. Who else is involved in supplier selection?', '• "We have existing suppliers" → We complement, not replace. Many clients use us for overflow or specialized sensors.\n• "Budget is locked" → Understood. Can we position for next fiscal year planning?', 'Engineering Managers', v_user_id);

  -- 7. Communications (outreach log)
  INSERT INTO campaign_communications (campaign_id, contact_id, account_id, communication_type, subject, body, outcome, notes, owner, created_by) VALUES
    (v_campaign_id, v_markus, v_claas, 'Email', 'Exploring sensing solutions for your automotive platform', 'Initial outreach email sent via campaign template.', 'Sent', 'First touch email sent. Awaiting response.', v_user_id, v_user_id),
    (v_campaign_id, v_athar, v_keboda, 'Phone', NULL, NULL, 'Interested', 'Spoke for 10 min. Interested in receiving product specs. Follow-up meeting next week.', v_user_id, v_user_id);

  RAISE NOTICE 'E2E test campaign created with ID: %', v_campaign_id;
END $$;
