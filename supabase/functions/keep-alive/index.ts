import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireCronSecret } from '../_shared/auth-gate.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Cron-only. Low-impact endpoint but no reason to leave it open to anons.
  const cron = requireCronSecret(req)
  if ('response' in cron) return cron.response

  try {
    console.log('keep-alive: Function triggered at', new Date().toISOString());
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('keep-alive: Missing environment variables');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Update the keep_alive table with current timestamp
    const { data, error } = await supabase
      .from('keep_alive')
      .update({ last_ping: new Date().toISOString() })
      .eq('id', 1)
      .select()
      .single();

    if (error) {
      console.error('keep-alive: Error updating keep_alive table:', error);
      
      // If no row exists, try to insert one
      if (error.code === 'PGRST116') {
        const { data: insertData, error: insertError } = await supabase
          .from('keep_alive')
          .insert({ 
            id: 1, 
            'Able to read DB': 'Yes', 
            last_ping: new Date().toISOString() 
          })
          .select()
          .single();

        if (insertError) {
          console.error('keep-alive: Error inserting into keep_alive table:', insertError);
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: insertError.message,
              timestamp: new Date().toISOString()
            }),
            { 
              status: 500, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }

        console.log('keep-alive: Created new keep_alive record:', insertData);
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'Keep-alive ping successful (created new record)',
            data: insertData,
            timestamp: new Date().toISOString()
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: false, 
          error: error.message,
          timestamp: new Date().toISOString()
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('keep-alive: Successfully pinged database:', data);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Keep-alive ping successful',
        data: data,
        timestamp: new Date().toISOString()
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('keep-alive: Function error:', errorMessage);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage,
        timestamp: new Date().toISOString()
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

