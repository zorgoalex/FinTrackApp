type SecurityEventClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

type SecurityOutcome = 'success' | 'failure' | 'blocked';
type SecuritySource = 'edge' | 'client' | 'monitor';
type Scalar = string | number | boolean | null;

type SecurityEvent = {
  eventType: string;
  outcome: SecurityOutcome;
  actorUserId?: string | null;
  targetUserId?: string | null;
  workspaceId?: string | null;
  subjectHash?: string | null;
  source?: SecuritySource;
  metadata?: Record<string, Scalar>;
};

function requestId(request?: Request) {
  const value = request?.headers.get('x-request-id')
    || request?.headers.get('sb-request-id')
    || request?.headers.get('cf-ray')
    || '';
  return /^[A-Za-z0-9_.:/-]{1,160}$/.test(value) ? value : null;
}

export async function recordSecurityEvent(
  admin: SecurityEventClient,
  event: SecurityEvent,
  request?: Request,
) {
  const { error } = await admin.rpc('record_security_event', {
    p_event_type: event.eventType,
    p_outcome: event.outcome,
    p_actor_user_id: event.actorUserId || null,
    p_target_user_id: event.targetUserId || null,
    p_workspace_id: event.workspaceId || null,
    p_subject_hash: event.subjectHash || null,
    p_request_id: requestId(request),
    p_source: event.source || 'edge',
    p_metadata: event.metadata || {},
  });
  if (error) {
    console.error('security-event write failed', event.eventType, event.outcome);
    return false;
  }
  return true;
}

export async function recordSecurityEventSafely(
  admin: SecurityEventClient,
  event: SecurityEvent,
  request?: Request,
) {
  try {
    return await recordSecurityEvent(admin, event, request);
  } catch {
    console.error('security-event write unavailable', event.eventType, event.outcome);
    return false;
  }
}
