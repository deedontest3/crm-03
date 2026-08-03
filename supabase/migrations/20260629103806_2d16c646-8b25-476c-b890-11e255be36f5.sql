GRANT INSERT, UPDATE ON public.currency_rates TO authenticated;

DROP POLICY IF EXISTS "Admins manage rates" ON public.currency_rates;
CREATE POLICY "Admins manage rates"
  ON public.currency_rates FOR ALL TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());