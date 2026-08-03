
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.52.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Previously this endpoint fabricated a random UUID as a "Teams join URL" and
// logged a fake TEAMS_MEETING_CREATED audit event. That link 404s in Teams —
// worse, downstream code and the audit trail believed a real meeting existed.
// Until a proper Microsoft Graph /onlineMeetings integration is wired up, this
// endpoint returns 501 and does NOT write to the audit log.
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Still require auth so we don't leak the "not configured" signal to
    // unauthenticated probes and so we get a real caller in logs if this is hit.
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.warn(`[create-teams-meeting] called by ${user.email} but Graph integration is not configured — returning 501`);
    return new Response(
      JSON.stringify({
        error: 'Teams meeting integration is not configured',
        detail: 'This endpoint no longer fabricates fake join links. Wire Microsoft Graph /onlineMeetings before enabling.',
      }),
      { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: any) {
    console.error('create-teams-meeting error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
