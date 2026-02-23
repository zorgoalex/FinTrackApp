import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 405,
    });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get the user accepting the invitation from their auth token
    const userResponse = await supabaseAdmin.auth.getUser(
      req.headers.get('Authorization')?.replace('Bearer ', '')
    );
    if (userResponse.error) {
      return new Response(JSON.stringify({ error: 'Authentication failed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }
    const acceptingUser = userResponse.data.user;

    // Get the invitation token from the request body
    const { token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing invitation token.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // 1. Find the invitation by its token
    const { data: invitation, error: findError } = await supabaseAdmin
      .from('workspace_invitations')
      .select('*')
      .eq('invitation_token', token)
      .single();

    if (findError || !invitation) {
      return new Response(JSON.stringify({ error: 'Invitation not found.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      });
    }

    // 2. Validate the invitation
    if (invitation.status !== 'pending') {
      return new Response(JSON.stringify({ error: `This invitation has already been ${invitation.status}.` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 410, // Gone
      });
    }

    // Security check: Ensure the logged-in user is the one who was invited
    const invitedEmail = invitation.invited_email?.trim().toLowerCase();
    const acceptingEmail = acceptingUser.email?.trim().toLowerCase();
    if (invitedEmail !== acceptingEmail) {
        return new Response(JSON.stringify({ error: 'This invitation is intended for a different email address.' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 403, // Forbidden
        });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      // Optionally update status to 'expired' in the DB
      await supabaseAdmin.from('workspace_invitations').update({ status: 'expired' }).eq('id', invitation.id);
      return new Response(JSON.stringify({ error: 'This invitation has expired.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 410, // Gone
      });
    }

    // 3. Add the user to the workspace_members table
    let memberInserted = false;
    const { error: memberError } = await supabaseAdmin
      .from('workspace_members')
      .insert({
        workspace_id: invitation.workspace_id,
        user_id: acceptingUser.id,
        role: invitation.role,
      });

    if (memberError) {
        // A 23505 error code means primary key violation (user is already a member).
        if (memberError.code === '23505') {
            console.warn('User is already a member of this workspace.');
        } else {
            console.error('Error adding user to workspace:', memberError);
            return new Response(JSON.stringify({ error: 'Failed to add user to the workspace.' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500,
            });
        }
    } else {
      memberInserted = true;
    }

    // 4. Update the invitation status to 'accepted'
    const { error: updateError } = await supabaseAdmin
      .from('workspace_invitations')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
      })
      .eq('id', invitation.id);

    if (updateError) {
      console.error('Error updating invitation status:', updateError);

      if (memberInserted) {
        const { error: rollbackError } = await supabaseAdmin
          .from('workspace_members')
          .delete()
          .eq('workspace_id', invitation.workspace_id)
          .eq('user_id', acceptingUser.id);

        if (rollbackError) {
          console.error('Rollback failed after invitation update error:', rollbackError);
        }
      }

      return new Response(JSON.stringify({ error: 'Failed to finalize invitation acceptance.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    // 5. Return a success response
    return new Response(JSON.stringify({ success: true, workspaceId: invitation.workspace_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Unexpected Error:', error.message);
    return new Response(JSON.stringify({ error: 'An unexpected error occurred.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
