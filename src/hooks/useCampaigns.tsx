import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";

export type Campaign = Tables<"campaigns">;

export interface CampaignFormData {
  campaign_name: string;
  campaign_type: string;
  goal: string;
  owner: string;
  start_date: string;
  end_date: string;
  status: string;
  notes?: string;
  description?: string;
  region?: string;
  country?: string;
  target_audience?: string;
  message_strategy?: string;
  mart_complete?: boolean;
}

export function useCampaigns() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const campaignsQuery = useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Campaign[];
    },
    enabled: !!user,
  });

  // Fetch MART status for all campaigns (for list page MART column)
  const martQuery = useQuery({
    queryKey: ["campaign-mart-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_mart")
        .select("*");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const createCampaign = useMutation({
    mutationFn: async (formData: CampaignFormData) => {
      const newId = crypto.randomUUID();
      const { error } = await supabase
        .from("campaigns")
        .insert({
          id: newId,
          campaign_name: formData.campaign_name,
          campaign_type: formData.campaign_type,
          goal: formData.goal,
          owner: formData.owner,
          start_date: formData.start_date,
          end_date: formData.end_date,
          status: formData.status || "Draft",
          notes: formData.notes || null,
          description: formData.description || null,
          region: formData.region || null,
          country: formData.country || null,
          target_audience: formData.target_audience || null,
          message_strategy: formData.message_strategy || null,
          created_by: user!.id,
        });
      if (error) throw error;

      // Auto-create campaign_mart row
      const { error: martError } = await supabase
        .from("campaign_mart")
        .insert({ campaign_id: newId });
      if (martError) console.error("Failed to create campaign_mart row:", martError);

      return { id: newId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["campaign-mart-all"] });
      toast({ title: "Campaign created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error creating campaign", description: error.message, variant: "destructive" });
    },
  });

  const updateCampaign = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<CampaignFormData> & { id: string }) => {
      const { data, error } = await supabase
        .from("campaigns")
        .update({ ...updates, modified_by: user!.id, modified_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["campaign", data.id] });
      toast({ title: "Campaign updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error updating campaign", description: error.message, variant: "destructive" });
    },
  });

  const deleteCampaign = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("campaigns").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      toast({ title: "Campaign deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error deleting campaign", description: error.message, variant: "destructive" });
    },
  });

  const archiveCampaign = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("campaigns")
        .update({ archived_at: new Date().toISOString(), archived_by: user!.id })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["archived-campaigns"] });
      toast({ title: "Campaign archived" });
    },
    onError: (error: Error) => {
      toast({ title: "Error archiving campaign", description: error.message, variant: "destructive" });
    },
  });

  const restoreCampaign = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("campaigns")
        .update({ archived_at: null, archived_by: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["archived-campaigns"] });
      toast({ title: "Campaign restored" });
    },
    onError: (error: Error) => {
      toast({ title: "Error restoring campaign", description: error.message, variant: "destructive" });
    },
  });

  const archivedCampaignsQuery = useQuery({
    queryKey: ["archived-campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .not("archived_at", "is", null)
        .order("archived_at", { ascending: false });
      if (error) throw error;
      return data as Campaign[];
    },
    enabled: !!user,
  });

  const cloneCampaign = useMutation({
    mutationFn: async (sourceId: string) => {
      // 1. Fetch source campaign
      const { data: source, error: srcErr } = await supabase
        .from("campaigns")
        .select("*")
        .eq("id", sourceId)
        .single();
      if (srcErr || !source) throw srcErr || new Error("Campaign not found");

      // 2. Insert cloned campaign (generate ID client-side to avoid SELECT RLS on RETURNING)
      const newId = crypto.randomUUID();
      const { error: insertErr } = await supabase
        .from("campaigns")
        .insert({
          id: newId,
          campaign_name: source.campaign_name + " (Copy)",
          campaign_type: source.campaign_type,
          goal: source.goal,
          owner: source.owner,
          start_date: source.start_date,
          end_date: source.end_date,
          status: "Draft",
          notes: source.notes,
          description: source.description,
          region: source.region,
          country: source.country,
          target_audience: source.target_audience,
          message_strategy: source.message_strategy,
          mart_complete: false,
          created_by: user!.id,
        });
      if (insertErr) throw insertErr;

      // 3. Clone MART (reset all flags)
      await supabase.from("campaign_mart").insert({ campaign_id: newId });

      // 4. Clone email templates
      const { data: templates } = await supabase
        .from("campaign_email_templates")
        .select("*")
        .eq("campaign_id", sourceId);
      if (templates?.length) {
        await supabase.from("campaign_email_templates").insert(
          templates.map((t) => ({
            campaign_id: newId,
            template_name: t.template_name,
            subject: t.subject,
            body: t.body,
            email_type: t.email_type,
            audience_segment: t.audience_segment,
            created_by: user!.id,
          }))
        );
      }

      // 5. Clone phone scripts
      const { data: scripts } = await supabase
        .from("campaign_phone_scripts")
        .select("*")
        .eq("campaign_id", sourceId);
      if (scripts?.length) {
        await supabase.from("campaign_phone_scripts").insert(
          scripts.map((s) => ({
            campaign_id: newId,
            script_name: s.script_name,
            opening_script: s.opening_script,
            key_talking_points: s.key_talking_points,
            discovery_questions: s.discovery_questions,
            objection_handling: s.objection_handling,
            audience_segment: s.audience_segment,
            created_by: user!.id,
          }))
        );
      }

      // 6. Clone accounts
      const { data: accounts } = await supabase
        .from("campaign_accounts")
        .select("*")
        .eq("campaign_id", sourceId);
      if (accounts?.length) {
        await supabase.from("campaign_accounts").insert(
          accounts.map((a) => ({
            campaign_id: newId,
            account_id: a.account_id,
            status: "Not Contacted",
            created_by: user!.id,
          }))
        );
      }

      // 7. Clone contacts
      const { data: contacts } = await supabase
        .from("campaign_contacts")
        .select("*")
        .eq("campaign_id", sourceId);
      if (contacts?.length) {
        await supabase.from("campaign_contacts").insert(
          contacts.map((c) => ({
            campaign_id: newId,
            contact_id: c.contact_id,
            account_id: c.account_id,
            stage: "Not Contacted",
            linkedin_status: "Not Contacted",
            created_by: user!.id,
          }))
        );
      }

      return newId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["campaign-mart-all"] });
      toast({ title: "Campaign cloned successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error cloning campaign", description: error.message, variant: "destructive" });
    },
  });

  // Compute MART progress for each campaign at list level
  const getMartProgress = (campaignId: string) => {
    const mart = martQuery.data?.find((m) => m.campaign_id === campaignId);
    if (!mart) return { count: 0, total: 4 };
    const count = [mart.message_done, mart.audience_done, mart.region_done, mart.timing_done].filter(Boolean).length;
    return { count, total: 4 };
  };

  return {
    campaigns: campaignsQuery.data || [],
    archivedCampaigns: archivedCampaignsQuery.data || [],
    isLoading: campaignsQuery.isLoading,
    error: campaignsQuery.error,
    createCampaign,
    updateCampaign,
    deleteCampaign,
    archiveCampaign,
    restoreCampaign,
    cloneCampaign,
    getMartProgress,
  };
}

export function useCampaignDetail(campaignId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const campaignQuery = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .eq("id", campaignId!)
        .single();
      if (error) throw error;
      return data as Campaign;
    },
    enabled: !!user && !!campaignId,
  });

  // MART state from explicit table
  const martQuery = useQuery({
    queryKey: ["campaign-mart", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_mart")
        .select("*")
        .eq("campaign_id", campaignId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!campaignId,
  });

  const accountsQuery = useQuery({
    queryKey: ["campaign-accounts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_accounts")
        .select("*, accounts(account_name, industry, region, country)")
        .eq("campaign_id", campaignId!);
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!campaignId,
  });

  const contactsQuery = useQuery({
    queryKey: ["campaign-contacts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_contacts")
        .select("*, contacts(contact_name, email, position, company_name)")
        .eq("campaign_id", campaignId!);
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!campaignId,
  });

  const communicationsQuery = useQuery({
    queryKey: ["campaign-communications", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_communications")
        .select("*, contacts(contact_name), accounts(account_name)")
        .eq("campaign_id", campaignId!)
        .order("communication_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!campaignId,
  });

  const emailTemplatesQuery = useQuery({
    queryKey: ["campaign-email-templates", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_email_templates")
        .select("*")
        .eq("campaign_id", campaignId!);
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!campaignId,
  });

  const phoneScriptsQuery = useQuery({
    queryKey: ["campaign-phone-scripts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_phone_scripts")
        .select("*")
        .eq("campaign_id", campaignId!);
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!campaignId,
  });

  const materialsQuery = useQuery({
    queryKey: ["campaign-materials", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_materials")
        .select("*")
        .eq("campaign_id", campaignId!);
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!campaignId,
  });

  // MART completion from explicit flags
  const mart = martQuery.data;
  const isMARTComplete = {
    message: mart?.message_done ?? false,
    audience: mart?.audience_done ?? false,
    region: mart?.region_done ?? false,
    timing: mart?.timing_done ?? false,
  };

  const martProgress = Object.values(isMARTComplete).filter(Boolean).length;
  const isFullyMARTComplete = martProgress === 4;

  // Campaign ended check — compare date strings to avoid timezone issues
  const isCampaignEnded = campaignQuery.data?.end_date
    ? campaignQuery.data.end_date < new Date().toISOString().split("T")[0]
    : false;

  const daysRemaining = campaignQuery.data?.end_date
    ? Math.max(0, Math.ceil((new Date(campaignQuery.data.end_date + "T00:00:00").getTime() - new Date(new Date().toISOString().split("T")[0] + "T00:00:00").getTime()) / (1000 * 60 * 60 * 24)))
    : null;

  // Update MART flag
  const updateMartFlag = async (flag: string, value: boolean) => {
    if (!campaignId) return;

    // Ensure MART row exists
    const { data: existing } = await supabase
      .from("campaign_mart")
      .select("campaign_id")
      .eq("campaign_id", campaignId)
      .maybeSingle();

    if (!existing) {
      await supabase.from("campaign_mart").insert({ campaign_id: campaignId, [flag]: value });
    } else {
      await supabase.from("campaign_mart").update({ [flag]: value }).eq("campaign_id", campaignId);
    }

    // Check if all 4 are now done
    const { data: updated } = await supabase
      .from("campaign_mart")
      .select("*")
      .eq("campaign_id", campaignId)
      .single();

    if (updated) {
      const allDone = updated.message_done && updated.audience_done && updated.region_done && updated.timing_done;
      await supabase.from("campaigns").update({ mart_complete: allDone }).eq("id", campaignId);
    }

    queryClient.invalidateQueries({ queryKey: ["campaign-mart", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-mart-all"] });
    queryClient.invalidateQueries({ queryKey: ["campaign", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaigns"] });
  };

  return {
    campaign: campaignQuery.data,
    isLoading: campaignQuery.isLoading,
    mart: martQuery.data,
    accounts: accountsQuery.data || [],
    contacts: contactsQuery.data || [],
    communications: communicationsQuery.data || [],
    emailTemplates: emailTemplatesQuery.data || [],
    phoneScripts: phoneScriptsQuery.data || [],
    materials: materialsQuery.data || [],
    isMARTComplete,
    martProgress,
    isFullyMARTComplete,
    isCampaignEnded,
    daysRemaining,
    updateMartFlag,
  };
}
