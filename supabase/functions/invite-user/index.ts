import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { emailConfig } from '../_shared/email-config.ts';
import emailTemplate from '../_shared/invite-email.html.ts';

Deno.serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get user from Authorization header to identify the inviter
    const userResponse = await supabaseAdmin.auth.getUser(
      req.headers.get('Authorization')?.replace('Bearer ', '')
    );
    if (userResponse.error) {
      return new Response(JSON.stringify({ error: 'Authentication failed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }
    const invitingUser = userResponse.data.user;

    // Validate request body
    const { workspaceId, email, role } = await req.json();
    if (!workspaceId || !email || !role) {
      return new Response(JSON.stringify({ error: 'Missing required fields: workspaceId, email, role' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // Check if the inviter has 'Owner' or 'Admin' role in the workspace
    const { data: userRole, error: roleError } = await supabaseAdmin.rpc('get_user_role_in_workspace', {
        workspace_uuid: workspaceId,
        user_uuid: invitingUser.id,
    });

    if (roleError || !['Owner', 'Admin'].includes(userRole)) {
        return new Response(JSON.stringify({ error: 'Permission denied: Only Owner or Admin can invite users.' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 403,
        });
    }

    // Create the invitation record in the database
    const { data: invitation, error: inviteError } = await supabaseAdmin
      .from('workspace_invitations')
      .insert({
        workspace_id: workspaceId,
        invited_email: email,
        role: role,
        invited_by: invitingUser.id,
        status: 'pending',
      })
      .select()
      .single();

    if (inviteError) {
      if (inviteError.code === '23505') { // unique_violation
        return new Response(JSON.stringify({ error: 'An invitation for this email address is already pending.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 409,
        });
      }
      console.error('DB Insert Error:', inviteError);
      return new Response(JSON.stringify({ error: 'Could not create invitation.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    // Fetch workspace details for the email content
    const { data: workspace } = await supabaseAdmin.from('workspaces').select('name').eq('id', workspaceId).single();

    // Construct email content
    const APP_URL = Deno.env.get('APP_BASE_URL') || 'http://localhost:3000';
    const acceptUrl = `${APP_URL}/accept-invitation?token=${invitation.invitation_token}`;

    // The HTML template is now imported directly as a string constant.

    // Populate the template with dynamic data
    const emailHtml = emailTemplate
      .replace('{{inviter_email}}', invitingUser.email)
      .replace('{{workspace_name}}', workspace?.name || 'a workspace')
      .replace('{{role}}', role)
      .replace('{{accept_url}}', acceptUrl)
      .replace('{{expires_at}}', new Date(invitation.expires_at).toLocaleString('ru-RU'));

    // Send the email using Resend
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${emailConfig.apiKey}`,
      },
      body: JSON.stringify({
        from: `${emailConfig.fromName} <${emailConfig.fromEmail}>`,
        to: [email],
        subject: `Invitation to join workspace: ${workspace?.name}`,
        html: emailHtml,
      }),
    });

    // If email is sent successfully, update the invitation record
    if (resendResponse.ok) {
        await supabaseAdmin
          .from('workspace_invitations')
          .update({ email_sent_at: new Date().toISOString(), email_sent_count: 1 })
          .eq('id', invitation.id);
    } else {
        console.warn('Failed to send email, but invitation was created.');
        const errorBody = await resendResponse.text();
        console.error('Resend API Error:', errorBody);
    }

    return new Response(JSON.stringify({ success: true, invitation_id: invitation.id }), {
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
