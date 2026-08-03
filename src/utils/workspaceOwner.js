const OWNER_PLACEHOLDERS = new Set(['owner', 'владелец']);

export function findOwnerEmail(profiles) {
  const owner = (profiles || []).find(
    profile => String(profile?.role || '').toLowerCase() === 'owner'
  );

  return typeof owner?.email === 'string' ? owner.email.trim() : '';
}

export function getOwnerDisplay(workspace) {
  const candidates = [workspace?.ownerEmail, workspace?.ownerName];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;

    const value = candidate.trim();
    if (value && !OWNER_PLACEHOLDERS.has(value.toLowerCase())) return value;
  }

  return '';
}
