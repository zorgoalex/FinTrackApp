import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, withCors } from '../_shared/cors.ts';
import { opaqueValue } from '../_shared/rateLimit.ts';
import { recordSecurityEventSafely } from '../_shared/securityEvents.ts';

Deno.serve(withCors(async (req: Request) => {
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
    if (userResponse.error || !userResponse.data.user) {
      return new Response(JSON.stringify({ error: 'Authentication failed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }
    const acceptingUser = userResponse.data.user;

    // Get the invitation token from the request body
    const { token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: 'Токен приглашения не указан.' }), {
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
      return new Response(JSON.stringify({ error: 'Приглашение не найдено или ссылка недействительна.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      });
    }

    // 2. Validate the recipient before disclosing invitation state.
    const invitedEmail = invitation.invited_email?.trim().toLowerCase();
    const acceptingEmail = acceptingUser.email?.trim().toLowerCase();
    const recipientSubject = await opaqueValue(invitedEmail || 'unknown');
    if (invitedEmail !== acceptingEmail) {
        await recordSecurityEventSafely(supabaseAdmin, {
          eventType: 'invitation.accept', outcome: 'blocked', actorUserId: acceptingUser.id,
          workspaceId: invitation.workspace_id, subjectHash: recipientSubject,
          metadata: { reason: 'recipient_mismatch' },
        }, req);
        return new Response(JSON.stringify({ error: 'Это приглашение предназначено для другого email.' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 403, // Forbidden
        });
    }

    // A repeated request from the accepted recipient is safe and must be idempotent.
    if (invitation.status === 'accepted') {
      const { data: existingMember, error: memberLookupError } = await supabaseAdmin
        .from('workspace_members')
        .select('workspace_id')
        .eq('workspace_id', invitation.workspace_id)
        .eq('user_id', acceptingUser.id)
        .maybeSingle();

      if (memberLookupError) {
        console.error('Accepted invitation membership lookup failed', memberLookupError.code || 'unknown');
        return new Response(JSON.stringify({ error: 'Не удалось проверить принятое приглашение.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        });
      }

      if (existingMember) {
        await recordSecurityEventSafely(supabaseAdmin, {
          eventType: 'invitation.accept', outcome: 'success', actorUserId: acceptingUser.id,
          workspaceId: invitation.workspace_id, subjectHash: recipientSubject,
          metadata: { role: String(invitation.role), idempotent: true },
        }, req);
        return new Response(JSON.stringify({
          success: true,
          workspaceId: invitation.workspace_id,
          alreadyAccepted: true,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      await recordSecurityEventSafely(supabaseAdmin, {
        eventType: 'invitation.accept', outcome: 'failure', actorUserId: acceptingUser.id,
        workspaceId: invitation.workspace_id, subjectHash: recipientSubject,
        metadata: { reason: 'accepted_membership_missing' },
      }, req);
      return new Response(JSON.stringify({ error: 'Не удалось подтвердить принятое приглашение.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 409,
      });
    }

    if (invitation.status !== 'pending') {
      return new Response(JSON.stringify({ error: 'Приглашение больше не активно.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 410, // Gone
      });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      // Optionally update status to 'expired' in the DB
      await supabaseAdmin.from('workspace_invitations').update({ status: 'expired' }).eq('id', invitation.id);
      await recordSecurityEventSafely(supabaseAdmin, {
        eventType: 'invitation.accept', outcome: 'failure', actorUserId: acceptingUser.id,
        workspaceId: invitation.workspace_id, subjectHash: recipientSubject,
        metadata: { reason: 'expired' },
      }, req);
      return new Response(JSON.stringify({ error: 'Срок действия приглашения истёк.' }), {
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
            console.error('Workspace membership insert failed', memberError.code || 'unknown');
            await recordSecurityEventSafely(supabaseAdmin, {
              eventType: 'invitation.accept', outcome: 'failure', actorUserId: acceptingUser.id,
              workspaceId: invitation.workspace_id, subjectHash: recipientSubject,
              metadata: { reason: 'membership_insert' },
            }, req);
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
      console.error('Invitation status update failed', updateError.code || 'unknown');

      if (memberInserted) {
        const { error: rollbackError } = await supabaseAdmin
          .from('workspace_members')
          .delete()
          .eq('workspace_id', invitation.workspace_id)
          .eq('user_id', acceptingUser.id);

        if (rollbackError) {
          console.error('Invitation rollback failed', rollbackError.code || 'unknown');
        }
      }

      await recordSecurityEventSafely(supabaseAdmin, {
        eventType: 'invitation.accept', outcome: 'failure', actorUserId: acceptingUser.id,
        workspaceId: invitation.workspace_id, subjectHash: recipientSubject,
        metadata: { reason: 'status_update' },
      }, req);

      return new Response(JSON.stringify({ error: 'Failed to finalize invitation acceptance.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    // 5. Return a success response
    await recordSecurityEventSafely(supabaseAdmin, {
      eventType: 'invitation.accept', outcome: 'success', actorUserId: acceptingUser.id,
      workspaceId: invitation.workspace_id, subjectHash: recipientSubject,
      metadata: { role: String(invitation.role) },
    }, req);
    return new Response(JSON.stringify({ success: true, workspaceId: invitation.workspace_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch {
    console.error('Unexpected invitation acceptance error');
    return new Response(JSON.stringify({ error: 'An unexpected error occurred.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
}));
