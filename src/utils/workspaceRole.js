const DATABASE_ROLES = new Map([
  ['owner', 'Owner'],
  ['admin', 'Admin'],
  ['member', 'Member'],
  ['viewer', 'Viewer'],
]);

export function toDatabaseWorkspaceRole(role) {
  if (typeof role !== 'string') return null;
  return DATABASE_ROLES.get(role.trim().toLowerCase()) || null;
}
