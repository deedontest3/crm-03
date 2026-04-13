CREATE TABLE public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view all email templates"
  ON public.email_templates FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert email templates"
  ON public.email_templates FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own templates, admins all"
  ON public.email_templates FOR UPDATE TO authenticated
  USING (is_user_admin() OR created_by = auth.uid());

CREATE POLICY "Users can delete their own templates, admins all"
  ON public.email_templates FOR DELETE TO authenticated
  USING (is_user_admin() OR created_by = auth.uid());

CREATE TRIGGER update_email_templates_updated_at
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();