REVOKE EXECUTE ON FUNCTION public.get_account_linked_contacts(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_account_linked_contacts(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_account_linked_contacts(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_linked_contacts(uuid[]) TO service_role;

REVOKE EXECUTE ON FUNCTION public.sync_contact_account_from_deal_links() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_contact_account_from_deal_links() FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_contact_account_from_deal_links() TO service_role;