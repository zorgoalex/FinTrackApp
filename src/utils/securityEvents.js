export async function recordClientSecurityEvent(supabase, eventType, workspaceId) {
  if (!supabase || !eventType || !workspaceId) return false;
  try {
    const { error } = await supabase.functions.invoke('security-event', {
      body: { eventType, workspaceId },
    });
    if (error) {
      console.warn('Security event could not be recorded');
      return false;
    }
    return true;
  } catch {
    console.warn('Security event service is unavailable');
    return false;
  }
}
