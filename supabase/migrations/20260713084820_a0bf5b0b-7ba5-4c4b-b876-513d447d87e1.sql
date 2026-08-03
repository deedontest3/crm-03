-- Case/whitespace-insensitive uniqueness on accounts.account_name.
-- Prevents duplicate accounts like "Acme", "acme ", "ACME" from being created.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_account_name_ci_unique
  ON public.accounts (lower(btrim(account_name)))
  WHERE account_name IS NOT NULL;