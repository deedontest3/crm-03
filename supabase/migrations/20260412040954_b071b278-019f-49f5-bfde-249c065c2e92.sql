INSERT INTO campaigns (id, campaign_name, campaign_type, goal, owner, created_by, start_date, end_date, status, description, notes)
VALUES (
  gen_random_uuid(),
  'E2E Test - Summer Sensor Campaign',
  'Nurture',
  'Test end-to-end campaign creation flow with all fields populated. Target 50 new sensor leads in APAC region.',
  'c9ae71ae-86b7-4467-a1b6-0b86bf38adff',
  'c9ae71ae-86b7-4467-a1b6-0b86bf38adff',
  '2026-07-01',
  '2026-09-30',
  'Draft',
  'Summer campaign targeting APAC sensor manufacturers for nurture outreach',
  'E2E test notes - verify MART 0/4 badge after creation'
);