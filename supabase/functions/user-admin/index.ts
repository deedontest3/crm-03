
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.52.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('User admin function called with method:', req.method);

    // Create admin client with service role key for full access
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Verify the user making the request is authenticated
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('No authorization header');
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: user, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user.user) {
      console.error('Authentication error:', authError);
      return new Response(
        JSON.stringify({ error: 'Invalid authentication token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Authenticated request by:', user.user.email);

    // Determine the caller's role STRICTLY from the user_roles table. We must
    // NOT fall back to user.user_metadata.role: user_metadata is writable by
    // the user themselves via auth.updateUser({ data }), so trusting it here
    // allowed any user whose user_roles row was missing to self-escalate to
    // super_admin. Every other authorization helper in this codebase
    // (is_user_admin / get_user_role / has_role) reads user_roles only.
    const { data: userRoleFromDB } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.user.id)
      .single();

    const effectiveRole = userRoleFromDB?.role || 'user';
    const isSuperAdmin = effectiveRole === 'super_admin';
    const isAdmin = effectiveRole === 'admin' || isSuperAdmin;

    console.log('User role from database:', userRoleFromDB?.role || 'no role found');
    console.log('Effective role:', effectiveRole, 'isAdmin:', isAdmin, 'isSuperAdmin:', isSuperAdmin);

    // GET - List all users (authenticated users see a safe projection only)
    if (req.method === 'GET') {
      console.log('Fetching users list...');

      const { data, error } = await supabaseAdmin.auth.admin.listUsers();

      if (error) {
        console.error('Error listing users:', error);
        return new Response(
          JSON.stringify({ error: `Failed to fetch users: ${error.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Project to safe fields only. Non-admins must NOT see other users' PII
      // (phone, app_metadata, identities, raw user_metadata, etc.).
      const safeUsers = (data?.users || []).map((u: any) => {
        const base = {
          id: u.id,
          email: isAdmin ? u.email : undefined,
          created_at: u.created_at,
          last_sign_in_at: isAdmin ? u.last_sign_in_at : undefined,
          banned_until: isAdmin ? u.banned_until : undefined,
          user_metadata: {
            full_name: u.user_metadata?.full_name ?? null,
            // role intentionally omitted — authoritative role lives in user_roles
          },
        };
        // Strip undefined keys so non-admins don't see masked-out fields at all
        return Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined));
      });

      console.log('Users fetched successfully:', safeUsers.length, 'isAdmin:', isAdmin);
      return new Response(
        JSON.stringify({ users: safeUsers }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }


    // POST - Create new user or handle specific actions
    if (req.method === 'POST') {
      const body = await req.json();
      console.log('POST request body:', JSON.stringify(body, null, 2));
      
      // Handle password reset with new password (admin only)
      if (body.action === 'reset-password') {
        if (!isAdmin) {
          console.log('Non-admin user attempted password reset:', user.user.email);
          return new Response(
            JSON.stringify({ error: 'Only Admins can reset user passwords' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { userId, newPassword } = body;
        if (!userId || !newPassword) {
          return new Response(
            JSON.stringify({ error: 'User ID and new password are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log('Resetting password for user:', userId);

        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
          userId,
          { password: newPassword }
        );

        if (error) {
          console.error('Error resetting password:', error);
          return new Response(
            JSON.stringify({ error: `Password reset failed: ${error.message}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log('Password reset successfully');
        return new Response(
          JSON.stringify({ 
            success: true,
            message: 'Password reset successfully'
          }),
          { 
            status: 200, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      // Handle role changes (SUPER ADMIN ONLY)
      if (body.action === 'change-role') {
        if (!isSuperAdmin) {
          console.log('Non-super-admin attempted role change:', user.user.email, 'for user:', body.userId);
          return new Response(
            JSON.stringify({ error: 'Only Super Admins can change user roles' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { userId, newRole } = body;
        const allowedRoles = ['super_admin', 'admin', 'sales_head', 'user'];
        if (!userId || !newRole || !allowedRoles.includes(newRole)) {
          return new Response(
            JSON.stringify({ error: `Valid user ID and role (${allowedRoles.join('/')}) are required` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Prevent demoting the last super admin
        if (newRole !== 'super_admin') {
          const { data: target } = await supabaseAdmin
            .from('user_roles')
            .select('role')
            .eq('user_id', userId)
            .maybeSingle();
          if (target?.role === 'super_admin') {
            const { count } = await supabaseAdmin
              .from('user_roles')
              .select('user_id', { count: 'exact', head: true })
              .eq('role', 'super_admin');
            if ((count || 0) <= 1) {
              return new Response(
                JSON.stringify({ error: 'Cannot demote the last Super Admin. Promote another user first.' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
          }
        }

        console.log('Super admin changing role for user:', userId, 'to:', newRole, 'by:', user.user.email);

        try {
          // Do NOT mirror the role into auth.user_metadata: that field is
          // client-writable and used to be a privilege-escalation vector.
          // The authoritative role lives in public.user_roles only.
          const { data: updatedUser } = await supabaseAdmin.auth.admin.getUserById(userId);


          const { error: roleError } = await supabaseAdmin.rpc('update_user_role', {
            p_user_id: userId,
            p_role: newRole,
          });
          if (roleError) {
            return new Response(
              JSON.stringify({ error: `Role update failed: ${roleError.message}` }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          // Server-side audit log
          await supabaseAdmin.from('security_audit_log').insert({
            user_id: user.user.id,
            action: 'ROLE_CHANGE',
            resource_type: 'user_roles',
            resource_id: userId,
            metadata: { new_role: newRole, changed_by_email: user.user.email },
          });

          return new Response(
            JSON.stringify({ success: true, message: `User role updated to ${newRole}`, user: updatedUser.user }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return new Response(
            JSON.stringify({ error: `Role update failed: ${errorMessage}` }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      // Handle user creation (admin only)
      if (!isAdmin) {
        console.log('Non-admin user attempted user creation:', user.user.email);
        return new Response(
          JSON.stringify({ error: 'Only Admins can create new users' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { email, displayName, role, password } = body;

      if (!email || !password || !displayName) {
        return new Response(
          JSON.stringify({ error: 'Email, password, and display name are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Validate the requested role and prevent privilege escalation: the role
      // is a client-supplied value, so a plain admin must not be able to mint a
      // super_admin/admin account (only super admins can — matching the
      // change-role handler above).
      const requestedRole = role || 'user';
      const allowedNewRoles = ['super_admin', 'admin', 'sales_head', 'user'];
      if (!allowedNewRoles.includes(requestedRole)) {
        return new Response(
          JSON.stringify({ error: 'Invalid role' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if ((requestedRole === 'super_admin' || requestedRole === 'admin') && !isSuperAdmin) {
        console.log('Non-super-admin attempted to create elevated user:', user.user.email, 'role:', requestedRole);
        return new Response(
          JSON.stringify({ error: 'Only Super Admins can create admin or super admin accounts' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Admin creating user:', email, 'with role:', requestedRole);

      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        user_metadata: {
          full_name: displayName
        },
        email_confirm: true
      });

      if (error) {
        console.error('Error creating user:', error);
        return new Response(
          JSON.stringify({ error: `User creation failed: ${error.message}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create profile record and set role
      if (data.user) {
        try {
          // Create profile
          const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .insert({
              id: data.user.id,
              full_name: displayName,
              'Email ID': email
            });

          if (profileError) {
            console.warn('Profile creation failed:', profileError);
          } else {
            console.log('Profile created successfully for:', email);
          }

          // Set user role
          const { error: roleError } = await supabaseAdmin
            .from('user_roles')
            .insert({
              user_id: data.user.id,
              role: requestedRole,
              assigned_by: user.user.id
            });

          if (roleError) {
            console.warn('Role assignment failed:', roleError);
          } else {
            console.log('Role assigned successfully:', requestedRole);
          }

        } catch (err) {
          console.warn('Setup error:', err);
        }
      }

      console.log('User created successfully:', data.user?.email);
      return new Response(
        JSON.stringify({ 
          success: true,
          user: data.user,
          message: 'User created successfully'
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // PUT - Update user (including activation/deactivation)
    if (req.method === 'PUT') {
      const { userId, displayName, action } = await req.json();
      
      if (!userId) {
        return new Response(
          JSON.stringify({ error: 'User ID is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check if this is a restricted action that requires admin privileges
      if (action === 'activate' || action === 'deactivate') {
        if (!isAdmin) {
          console.log('Non-admin user attempted user status change:', user.user.email, 'action:', action);
          return new Response(
            JSON.stringify({ error: 'Only Admins can activate/deactivate users' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      // A plain displayName update may only target the caller's own account
      // unless the caller is an admin. Previously any authenticated user could
      // rename any other user by passing an arbitrary userId.
      if (displayName !== undefined && userId !== user.user.id && !isAdmin) {
        console.log('Non-admin user attempted to update another user profile:', user.user.email, '->', userId);
        return new Response(
          JSON.stringify({ error: 'You can only update your own profile' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Updating user:', userId, 'action:', action, 'displayName:', displayName);

      // Prepare update data for auth.users
      let updateData: any = {};

      // Handle display name updates (allow all authenticated users for their own profile updates)
      if (displayName !== undefined) {
        updateData.user_metadata = { full_name: displayName };
      }

      // Handle user activation/deactivation (admin only)
      if (action === 'activate') {
        updateData.ban_duration = 'none';
        console.log('Admin activating user:', userId);
      } else if (action === 'deactivate') {
        updateData.ban_duration = '876000h'; // ~100 years
        console.log('Admin deactivating user:', userId);
      }

      // Update auth user if needed
      if (Object.keys(updateData).length > 0) {
        console.log('Update data prepared:', JSON.stringify(updateData, null, 2));

        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
          userId,
          updateData
        );

        if (error) {
          console.error('Error updating user:', error);
          return new Response(
            JSON.stringify({ error: `User update failed: ${error.message}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      // Update profile if display name changed
      if (displayName !== undefined) {
        try {
          const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .update({ full_name: displayName })
            .eq('id', userId);

          if (profileError) {
            console.warn('Profile update failed:', profileError);
          } else {
            console.log('Profile updated successfully for user:', userId);
          }
        } catch (profileErr) {
          console.warn('Profile update error:', profileErr);
        }
      }

      console.log('User updated successfully:', userId);
      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'User updated successfully'
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // DELETE - Delete user (super admin only) – tombstone approach.
    // We KEEP the profiles row (flagged is_deleted) so historical references
    // (created_by, modified_by, assigned_to, contact_owner, sent_by, …) on
    // deals / leads / contacts / campaigns / action_items / email_history /
    // notifications continue to resolve to the original user's name.
    if (req.method === 'DELETE') {
      if (!isSuperAdmin) {
        console.log('Non-super-admin attempted user deletion:', user.user.email);
        return new Response(
          JSON.stringify({ error: 'Only Super Admins can delete users' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { userId } = await req.json();

      if (!userId) {
        return new Response(
          JSON.stringify({ error: 'User ID is required for deletion' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (userId === user.user.id) {
        return new Response(
          JSON.stringify({ error: 'You cannot delete your own account. Ask another Super Admin to do it.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Prevent removing the last super admin
      const { data: targetRole } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();
      if (targetRole?.role === 'super_admin') {
        const { count } = await supabaseAdmin
          .from('user_roles')
          .select('user_id', { count: 'exact', head: true })
          .eq('role', 'super_admin');
        if ((count || 0) <= 1) {
          return new Response(
            JSON.stringify({ error: 'Cannot delete the last Super Admin. Promote another user first.' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      // Snapshot profile name/email BEFORE we touch anything else
      const { data: targetProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, "Email ID", is_deleted')
        .eq('id', userId)
        .maybeSingle();

      const alreadyTombstoned = !!targetProfile?.is_deleted;

      // If profile is already tombstoned, just retry the auth deletion (idempotent).
      if (alreadyTombstoned) {
        console.log('Profile already tombstoned, retrying auth deletion for:', userId);
        const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (authDeleteError) {
          console.error('Auth deletion retry failed:', authDeleteError);
          return new Response(
            JSON.stringify({
              success: true,
              warning: `Profile is archived. Auth account removal still failing: ${authDeleteError.message}`,
              userId,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ success: true, message: 'Auth account removed. Historical records preserved.', userId }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Super admin tombstoning user:', userId, 'by', user.user.email);

      try {
        // 1) Purge ONLY personal / preference data.
        //    Everything else (deals, leads, contacts, campaigns, action_items,
        //    email_history, audit log, etc.) is preserved so created_by /
        //    modified_by / assigned_to keep pointing at the tombstoned profile.
        const purgeTables = [
          'notifications',
          'notification_preferences',
          'saved_filters',
          'dashboard_preferences',
          'column_preferences',
          'user_preferences',
          'user_sessions',
          'user_roles',
        ];
        const purged: Record<string, number | string> = {};
        for (const table of purgeTables) {
          const { error, count } = await supabaseAdmin
            .from(table)
            .delete({ count: 'exact' })
            .eq('user_id', userId);
          if (error) {
            console.warn(`Purge ${table} failed:`, error.message);
            purged[table] = `error: ${error.message}`;
          } else {
            purged[table] = count ?? 0;
          }
        }

        // 2) Tombstone the profile (keep id, full_name, email so history resolves).
        const { error: tombstoneError } = await supabaseAdmin
          .from('profiles')
          .update({
            is_deleted: true,
            deleted_at: new Date().toISOString(),
            deleted_by: user.user.id,
            deleted_email: targetProfile?.['Email ID'] ?? null,
          })
          .eq('id', userId);

        if (tombstoneError) {
          console.error('Failed to tombstone profile:', tombstoneError);
          return new Response(
            JSON.stringify({ error: `Failed to mark profile as deleted: ${tombstoneError.message}` }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // 3) Audit log
        await supabaseAdmin.from('security_audit_log').insert({
          user_id: user.user.id,
          action: 'USER_DELETED',
          resource_type: 'users',
          resource_id: userId,
          metadata: {
            deleted_email: targetProfile?.['Email ID'],
            deleted_full_name: targetProfile?.full_name,
            performed_by_email: user.user.email,
            purged,
          },
        });

        // 4) Finally remove the auth account so the user can no longer sign in.
        const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (authDeleteError) {
          // Profile is already tombstoned; surface a warning but don't fail.
          console.error('Auth deletion failed after tombstone:', authDeleteError);
          return new Response(
            JSON.stringify({
              success: true,
              warning: `Profile archived but auth deletion failed: ${authDeleteError.message}`,
              userId,
              purged,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log('User tombstoned + auth-deleted successfully:', userId);
        return new Response(
          JSON.stringify({
            success: true,
            message: 'User deleted. Historical records remain attributed to this user.',
            userId,
            purged,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (deleteError: any) {
        console.error('Unexpected error during user deletion:', deleteError);
        return new Response(
          JSON.stringify({ error: `Deletion failed: ${deleteError.message || 'Unknown error'}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Method not allowed
    return new Response(
      JSON.stringify({ error: `Method ${req.method} not allowed` }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Unexpected error in user-admin function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error.message || 'An unexpected error occurred'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
