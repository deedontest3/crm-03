
-- 1) Preserve tombstoned profiles: remove cascade from profiles.id -> auth.users
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- 2) Make all historical attribution FKs survive auth user deletion via SET NULL.
-- Drop and recreate each as ON DELETE SET NULL.
DO $$
DECLARE
  rec RECORD;
  fks TEXT[][] := ARRAY[
    ['backup_schedules','backup_schedules_created_by_fkey','created_by'],
    ['backups','backups_created_by_fkey','created_by'],
    ['campaign_audience_personas','campaign_audience_personas_created_by_fkey','created_by'],
    ['campaign_timing_windows','campaign_timing_windows_created_by_fkey','created_by'],
    ['contacts','contacts_contact_owner_fkey','contact_owner'],
    ['contacts','contacts_created_by_fkey','created_by'],
    ['contacts','contacts_modified_by_fkey','modified_by'],
    ['deal_action_items','deal_action_items_assigned_to_fkey','assigned_to'],
    ['deal_action_items','deal_action_items_created_by_fkey','created_by'],
    ['deals','deals_created_by_fkey','created_by'],
    ['deals','deals_modified_by_fkey','modified_by'],
    ['email_history','email_history_sent_by_fkey','sent_by'],
    ['email_templates','email_templates_created_by_fkey','created_by'],
    ['lead_action_items','lead_action_items_assigned_to_fkey','assigned_to'],
    ['lead_action_items','lead_action_items_created_by_fkey','created_by'],
    ['leads','leads_contact_owner_fkey','contact_owner'],
    ['leads','leads_created_by_fkey','created_by'],
    ['leads','leads_modified_by_fkey','modified_by'],
    ['user_roles','user_roles_assigned_by_fkey','assigned_by'],
    ['yearly_revenue_targets','yearly_revenue_targets_created_by_fkey','created_by']
  ];
  i INT;
BEGIN
  FOR i IN 1 .. array_length(fks, 1) LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', fks[i][1], fks[i][2]);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE SET NULL',
      fks[i][1], fks[i][2], fks[i][3]
    );
  END LOOP;
END $$;
