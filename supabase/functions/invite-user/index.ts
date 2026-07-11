import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FROM_EMAIL = 'onboarding@resend.dev';
const FROM_NAME = 'FinTrackApp (Test)';

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function invitationEmailHtml({ inviterEmail, workspaceName, role, acceptUrl, expiresAt }: {
  inviterEmail: string;
  workspaceName: string;
  role: string;
  acceptUrl: string;
  expiresAt: string;
}) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Приглашение в FinTrackApp</title></head>
  <body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px">
    <div style="background:#fff;max-width:600px;margin:0 auto;padding:24px;border-radius:8px">
      <h1 style="color:#333">Вас пригласили в рабочее пространство</h1>
      <p style="color:#555;line-height:1.6">Пользователь <strong>${escapeHtml(inviterEmail)}</strong> приглашает вас в пространство «<strong>${escapeHtml(workspaceName)}</strong>» с ролью <strong>${escapeHtml(role)}</strong>.</p>
      <a href="${escapeHtml(acceptUrl)}" style="display:inline-block;background:#0066cc;color:#fff;padding:12px 25px;text-decoration:none;border-radius:5px;font-weight:bold">Принять приглашение</a>
      <p style="margin-top:20px;font-size:12px;color:#888">Приглашение действительно до ${escapeHtml(expiresAt)}.</p>
      <p style="font-size:12px;color:#888">Если вы не ожидали этого приглашения, его можно проигнорировать.</p>
    </div>
  </body></html>`;
}

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
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const appBaseUrl = Deno.env.get('APP_BASE_URL');
    if (!appBaseUrl) {
      return new Response(JSON.stringify({ error: 'Server misconfiguration: APP_BASE_URL is required.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

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
    const normalizedEmail = typeof email === 'string' ? email.toLowerCase().trim() : '';
    // Capitalize first letter: 'member' → 'Member', 'admin' → 'Admin'
    const rawRole = typeof role === 'string' ? role.trim() : '';
    const normalizedRole = rawRole.charAt(0).toUpperCase() + rawRole.slice(1).toLowerCase();
    const allowedRoles = ['Admin', 'Member', 'Viewer'];

    if (!workspaceId || !normalizedEmail || !normalizedRole) {
      return new Response(JSON.stringify({ error: 'Missing required fields: workspaceId, email, role' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }
    if (!allowedRoles.includes(normalizedRole)) {
      return new Response(JSON.stringify({ error: 'Invalid role. Allowed values: Admin, Member, Viewer.' }), {
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
        invited_email: normalizedEmail,
        role: normalizedRole,
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
    const acceptUrl = `${appBaseUrl}/accept-invitation?token=${invitation.invitation_token}`;

    // The HTML template is now imported directly as a string constant.

    // Populate the template with dynamic data
    const emailHtml = invitationEmailHtml({
      inviterEmail: invitingUser.email || '',
      workspaceName: workspace?.name || 'рабочее пространство',
      role: normalizedRole,
      acceptUrl,
      expiresAt: new Date(invitation.expires_at).toLocaleString('ru-RU'),
    });

    // Send the email using Resend
    // Update invitation record and track email delivery
    let emailSent = false;
    let emailError = '';
    if (!resendApiKey) {
      emailError = 'Email delivery is not configured yet';
    } else {
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: `${FROM_NAME} <${FROM_EMAIL}>`,
          to: [normalizedEmail],
          subject: `Invitation to join workspace: ${workspace?.name}`,
          html: emailHtml,
        }),
      });

      if (resendResponse.ok) {
        emailSent = true;
        await supabaseAdmin
          .from('workspace_invitations')
          .update({
            email_sent_at: new Date().toISOString(),
            email_sent_count: (invitation.email_sent_count ?? 0) + 1,
          })
          .eq('id', invitation.id);
      } else {
        const errorBody = await resendResponse.text();
        console.error('Resend API Error:', errorBody);
        emailError = errorBody || 'Unknown Resend error';
        // Invitation saved — don't fail, return the link so sender can share manually
      }
    }

    return new Response(JSON.stringify({
      success: true,
      invitation_id: invitation.id,
      email_sent: emailSent,
      accept_url: acceptUrl,
      ...(emailError ? { email_warning: `Email not delivered: ${emailError}. Share this link manually: ${acceptUrl}` } : {}),
    }), {
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
