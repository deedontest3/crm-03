
-- Step 1: Fix constraint
ALTER TABLE action_items DROP CONSTRAINT action_items_module_type_check;
ALTER TABLE action_items ADD CONSTRAINT action_items_module_type_check 
  CHECK (module_type = ANY (ARRAY['deals','accounts','contacts','campaigns','leads']));

-- Step 2: Campaigns
INSERT INTO campaigns (id, campaign_name, campaign_type, goal, owner, start_date, end_date, status, description, region, country, target_audience, message_strategy, mart_complete, created_by)
VALUES
  ('a1b2c3d4-1111-4000-a000-000000000001', 'Q2 Automotive Outreach', 'Email + Phone', 'Generate 10 qualified leads from Tier-1 automotive suppliers in DACH region', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff', '2026-04-01', '2026-06-30', 'Active', 'Multi-channel outreach targeting brake, drivetrain, and agricultural OEMs.', 'DACH', 'Germany', 'Engineering Directors at Tier-1 automotive suppliers', 'Lead with ROI data from BREMBO case study. 40% reduction in validation cycles.', true, 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-2222-4000-a000-000000000002', 'ADAS Product Launch', 'Email', 'Introduce new ADAS testing module to 20 prospects', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff', '2026-05-01', '2026-08-31', 'Draft', 'Pre-launch campaign for ADAS functional safety testing product.', 'Asia', 'Japan', 'Safety engineers and ADAS program managers', NULL, false, 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-3333-4000-a000-000000000003', 'Lighting Division Expansion', 'Phone + LinkedIn', 'Close 3 deals in automotive lighting ECU testing', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff', '2026-01-15', '2026-03-31', 'Completed', 'Targeted outreach to lighting OEMs for ECU validation contracts.', 'Europe', 'Germany', NULL, NULL, true, 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff');

-- Step 3: MART
INSERT INTO campaign_mart (campaign_id, message_done, audience_done, region_done, timing_done, timing_notes) VALUES
  ('a1b2c3d4-1111-4000-a000-000000000001', true, true, true, true, 'Best window: Tue-Thu 10-12 CET.'),
  ('a1b2c3d4-2222-4000-a000-000000000002', true, true, false, false, NULL),
  ('a1b2c3d4-3333-4000-a000-000000000003', true, true, true, true, 'Campaign completed on schedule.');

-- Step 4: Accounts
INSERT INTO campaign_accounts (campaign_id, account_id, status, created_by) VALUES
  ('a1b2c3d4-1111-4000-a000-000000000001', '379f0c12-00e5-436d-8f6c-42a64f3f8e67', 'Contacted', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-1111-4000-a000-000000000001', '440daf8d-f1ef-4a82-8f98-89e5dc923c46', 'Responded', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-1111-4000-a000-000000000001', '3a476ca0-b553-4422-a405-4a6332239578', 'Not Contacted', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-2222-4000-a000-000000000002', '8188efa4-1ae2-4138-ba4f-437e7b35fdf3', 'Not Contacted', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-2222-4000-a000-000000000002', '50386497-ab54-4751-ade8-a549270f235c', 'Not Contacted', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-3333-4000-a000-000000000003', '52aa358c-7357-4547-8693-cf5e9d47c011', 'Deal Created', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-3333-4000-a000-000000000003', '46b9cdcc-c69f-42de-8e89-1b5825e9840b', 'Responded', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff');

-- Step 5: Contacts
INSERT INTO campaign_contacts (campaign_id, contact_id, account_id, stage, linkedin_status, created_by) VALUES
  ('a1b2c3d4-1111-4000-a000-000000000001', '85e76fb4-7fa9-47ef-8ee1-430f81890574', '379f0c12-00e5-436d-8f6c-42a64f3f8e67', 'Email Sent', 'Not Contacted', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-1111-4000-a000-000000000001', 'a64f068e-4b53-4c53-a2cf-f7dab106a947', '379f0c12-00e5-436d-8f6c-42a64f3f8e67', 'Phone Contacted', 'Connected', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-1111-4000-a000-000000000001', '09694a49-8178-43c5-92df-25ff418afdbf', '440daf8d-f1ef-4a82-8f98-89e5dc923c46', 'Responded', 'Message Sent', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-1111-4000-a000-000000000001', '1adb4b2c-f3bf-4282-9e4f-3b791740e0d0', '440daf8d-f1ef-4a82-8f98-89e5dc923c46', 'Not Contacted', 'Not Contacted', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-2222-4000-a000-000000000002', 'ffa147ed-cd9b-4367-9fe3-eb4cd4b39af9', '8188efa4-1ae2-4138-ba4f-437e7b35fdf3', 'Not Contacted', 'Not Contacted', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-2222-4000-a000-000000000002', 'cf637fdc-376d-43a2-b265-77adc4d6f43c', '50386497-ab54-4751-ade8-a549270f235c', 'Not Contacted', 'Not Contacted', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-3333-4000-a000-000000000003', 'bf607b6a-68e3-4bcf-aac9-224246035c25', '52aa358c-7357-4547-8693-cf5e9d47c011', 'Qualified', 'Connected', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-3333-4000-a000-000000000003', 'ed8837ce-6b47-4d2b-aebf-24bfcec2c648', '52aa358c-7357-4547-8693-cf5e9d47c011', 'Responded', 'Message Sent', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-3333-4000-a000-000000000003', '2e86b158-347f-4692-b687-98b7f7a650e1', '46b9cdcc-c69f-42de-8e89-1b5825e9840b', 'Responded', 'Not Contacted', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff');

-- Step 6: Email Templates
INSERT INTO campaign_email_templates (campaign_id, template_name, email_type, subject, body, audience_segment, created_by) VALUES
  ('a1b2c3d4-1111-4000-a000-000000000001', 'Initial Outreach', 'cold', 'Reduce Validation Cycles by 40%', 'Dear {{contact_name}},\n\nI wanted to share how BREMBO reduced their ECU validation cycles by 40%.\n\nWould you be open to a 15-minute call?\n\nBest regards', 'Engineering Directors', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-1111-4000-a000-000000000001', 'Follow-up #1', 'follow_up', 'Quick follow-up: Validation efficiency', 'Hi {{contact_name}},\n\nJust following up. I''d love to walk you through a demo tailored to {{company_name}}.\n\nAvailable Thursday?', 'Engineering Directors', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-2222-4000-a000-000000000002', 'ADAS Launch Invite', 'cold', 'Introducing: ADAS Functional Safety Testing Module', 'Dear {{contact_name}},\n\nWe''re launching a new ADAS testing module for ISO 26262 compliance.\n\nJoin our preview webinar on May 15th.', 'Safety Engineers', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff');

-- Step 7: Phone Script
INSERT INTO campaign_phone_scripts (campaign_id, script_name, opening_script, key_talking_points, discovery_questions, objection_handling, audience_segment, created_by) VALUES
  ('a1b2c3d4-1111-4000-a000-000000000001', 'Q2 DACH Outreach Script',
   'Hi {{contact_name}}, this is [Name] from RealThingks. We recently helped BREMBO cut ECU validation time by 40%.',
   '["40% reduction in validation cycles at BREMBO","Full AUTOSAR and ISO 26262 compliance","ROI visible within first quarter","Seamless CI/CD integration"]',
   '["What does your current ECU validation workflow look like?","How many validation cycles per release?","Biggest pain point in testing?","Using any automated testing tools?"]',
   '[{"objection":"We have an in-house solution","response":"Many clients started that way. We complement existing setups. Open to seeing how?"},{"objection":"Budget is tight","response":"BREMBO saw 3x ROI in 6 months. Want to see the analysis?"}]',
   'Engineering Directors', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff');

-- Step 8: Communications
INSERT INTO campaign_communications (campaign_id, contact_id, account_id, communication_type, communication_date, subject, body, email_type, email_status, notes, owner, created_by) VALUES
  ('a1b2c3d4-1111-4000-a000-000000000001', '85e76fb4-7fa9-47ef-8ee1-430f81890574', '379f0c12-00e5-436d-8f6c-42a64f3f8e67', 'Email', '2026-04-05 10:30:00+02', 'Reduce Validation Cycles by 40%', 'Sent initial outreach email.', 'cold', 'Sent', 'Used Initial Outreach template', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-1111-4000-a000-000000000001', '09694a49-8178-43c5-92df-25ff418afdbf', '440daf8d-f1ef-4a82-8f98-89e5dc923c46', 'Email', '2026-04-08 09:15:00+02', 'Quick follow-up', 'Follow-up sent.', 'follow_up', 'Replied', 'Replied asking for pricing', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff');

INSERT INTO campaign_communications (campaign_id, contact_id, account_id, communication_type, communication_date, call_outcome, notes, owner, created_by) VALUES
  ('a1b2c3d4-1111-4000-a000-000000000001', 'a64f068e-4b53-4c53-a2cf-f7dab106a947', '379f0c12-00e5-436d-8f6c-42a64f3f8e67', 'Phone', '2026-04-07 14:00:00+02', 'Interested', 'Spoke 12 min. Interested in demo.', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-1111-4000-a000-000000000001', '09694a49-8178-43c5-92df-25ff418afdbf', '440daf8d-f1ef-4a82-8f98-89e5dc923c46', 'LinkedIn', '2026-04-09 11:00:00+02', NULL, 'Connected on LinkedIn. Sent intro message.', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff');

INSERT INTO campaign_communications (campaign_id, contact_id, account_id, communication_type, communication_date, call_outcome, notes, owner, created_by) VALUES
  ('a1b2c3d4-3333-4000-a000-000000000003', 'bf607b6a-68e3-4bcf-aac9-224246035c25', '52aa358c-7357-4547-8693-cf5e9d47c011', 'Phone', '2026-02-01 10:00:00+01', 'Interested', 'Initial discovery call. Very interested.', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-3333-4000-a000-000000000003', 'bf607b6a-68e3-4bcf-aac9-224246035c25', '52aa358c-7357-4547-8693-cf5e9d47c011', 'Phone', '2026-02-15 14:30:00+01', 'Demo Scheduled', 'Scheduled demo for Feb 20.', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-3333-4000-a000-000000000003', 'ed8837ce-6b47-4d2b-aebf-24bfcec2c648', '52aa358c-7357-4547-8693-cf5e9d47c011', 'Phone', '2026-02-18 09:00:00+01', 'Interested', 'Connected. Wants team lead input.', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('a1b2c3d4-3333-4000-a000-000000000003', '2e86b158-347f-4692-b687-98b7f7a650e1', '46b9cdcc-c69f-42de-8e89-1b5825e9840b', 'Email', '2026-02-05 10:00:00+01', NULL, 'Sent product brochure and pricing.', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff');

-- Step 9: Tasks
INSERT INTO action_items (title, description, module_type, module_id, priority, status, due_date, assigned_to, created_by) VALUES
  ('Send pricing proposal to AISIN', 'Prepare customized pricing for AISIN automotive.', 'campaigns', 'a1b2c3d4-1111-4000-a000-000000000001', 'High', 'Open', '2026-04-18', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('Schedule demo with Markus Kohler', 'Follow up on phone call interest.', 'campaigns', 'a1b2c3d4-1111-4000-a000-000000000001', 'Medium', 'In Progress', '2026-04-15', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('Prepare Claas case study', 'Agricultural machinery testing case study.', 'campaigns', 'a1b2c3d4-1111-4000-a000-000000000001', 'High', 'Open', '2026-04-20', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('Send final contract to GLIWA', 'Contract reviewed by legal.', 'campaigns', 'a1b2c3d4-3333-4000-a000-000000000003', 'High', 'Completed', '2026-03-15', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff'),
  ('Close campaign report', 'Final analytics for management.', 'campaigns', 'a1b2c3d4-3333-4000-a000-000000000003', 'Medium', 'Completed', '2026-03-31', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff');

-- Step 10: Converted Deal
INSERT INTO deals (id, deal_name, project_name, customer_name, stage, created_by, lead_owner, region, campaign_id, account_id, total_contract_value, expected_closing_date, current_status)
VALUES (
  'a1b2c3d4-d001-4000-a000-000000000001',
  'GLIWA Lighting ECU Project', 'GLIWA Lighting ECU Validation', 'GLIWA GmbH',
  'Qualified', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff', 'c9ae71ae-86b7-4467-a1b6-0b86bf38adff',
  'Europe', 'a1b2c3d4-3333-4000-a000-000000000003', '52aa358c-7357-4547-8693-cf5e9d47c011',
  85000, '2026-06-30', 'Demo completed. Awaiting budget approval.');
