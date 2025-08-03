import { useWorkspace } from '../contexts/WorkspaceContext';

/**
 * Хук для проверки прав пользователя в текущем workspace
 * @returns {Object} Объект с булевыми флагами прав
 */
export function usePermissions() {
  const { 
    userRole,
    canInviteUsers,
    canManageRoles,
    canDeleteWorkspace,
    canEditOperations,
    canViewOperations
  } = useWorkspace();

  // Детальные проверки прав
  const permissions = {
    // Основные права
    canInvite: canInviteUsers,
    canManageRoles: canManageRoles,
    canDelete: canDeleteWorkspace,
    canEdit: canEditOperations,
    canView: canViewOperations,
    
    // Детальные права
    canInviteMembers: ['owner', 'admin'].includes(userRole),
    canInviteAdmins: userRole === 'owner',
    canRemoveMembers: userRole === 'owner',
    canChangeRoles: userRole === 'owner',
    canViewMembers: ['owner', 'admin', 'member', 'viewer'].includes(userRole),
    
    // Права на операции
    canCreateOperations: ['owner', 'admin', 'member'].includes(userRole),
    canEditOwnOperations: ['owner', 'admin', 'member'].includes(userRole),
    canEditAllOperations: ['owner', 'admin'].includes(userRole),
    canDeleteOperations: ['owner', 'admin'].includes(userRole),
    canViewOperations: ['owner', 'admin', 'member', 'viewer'].includes(userRole),
    
    // Права на настройки
    canEditWorkspaceSettings: ['owner', 'admin'].includes(userRole),
    canViewWorkspaceSettings: ['owner', 'admin'].includes(userRole),
    canManageWorkspace: userRole === 'owner',
    
    // Права на справочники (для будущих фаз)
    canEditDirectories: ['owner', 'admin'].includes(userRole),
    canViewDirectories: ['owner', 'admin', 'member', 'viewer'].includes(userRole),
    
    // Права на аналитику
    canViewAnalytics: ['owner', 'admin', 'member', 'viewer'].includes(userRole),
    canExportData: ['owner', 'admin', 'member'].includes(userRole),
    
    // Дополнительные проверки
    isOwner: userRole === 'owner',
    isAdmin: userRole === 'admin',
    isMember: userRole === 'member',
    isViewer: userRole === 'viewer',
    hasManagementRights: ['owner', 'admin'].includes(userRole),
    hasEditRights: ['owner', 'admin', 'member'].includes(userRole),
    
    // Права на выход/удаление
    canLeaveWorkspace: ['member', 'viewer'].includes(userRole),
    canDeleteWorkspace: userRole === 'owner'
  };

  return permissions;
}

/**
 * Хук для проверки конкретного права
 * @param {string} permission Название права для проверки
 * @returns {boolean} Результат проверки
 */
export function usePermission(permission) {
  const permissions = usePermissions();
  return permissions[permission] || false;
}

/**
 * Хук для проверки роли пользователя
 * @param {string|string[]} roles Роль или массив ролей для проверки
 * @returns {boolean} Результат проверки
 */
export function useHasRole(roles) {
  const { userRole } = useWorkspace();
  
  if (Array.isArray(roles)) {
    return roles.includes(userRole);
  }
  
  return userRole === roles;
}

/**
 * Хук для проверки минимального уровня прав
 * @param {string} minRole Минимальная роль
 * @returns {boolean} Результат проверки
 */
export function useHasMinRole(minRole) {
  const { userRole } = useWorkspace();
  
  const roleHierarchy = {
    'viewer': 1,
    'member': 2,
    'admin': 3,
    'owner': 4
  };
  
  const userLevel = roleHierarchy[userRole] || 0;
  const minLevel = roleHierarchy[minRole] || 0;
  
  return userLevel >= minLevel;
}