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


  // Нормализуем роль к нижнему регистру для проверок
  const normalizedRole = userRole?.toLowerCase();

  // Детальные проверки прав
  const permissions = {
    // Основные права
    canInvite: canInviteUsers,
    canManageRoles: canManageRoles,
    canDelete: canDeleteWorkspace,
    canEdit: canEditOperations,
    canView: canViewOperations,
    
    // Детальные права
    canInviteMembers: ['owner', 'admin'].includes(normalizedRole),
    canInviteAdmins: normalizedRole === 'owner',
    canRemoveMembers: normalizedRole === 'owner',
    canChangeRoles: normalizedRole === 'owner',
    canViewMembers: ['owner', 'admin', 'member', 'viewer'].includes(normalizedRole),
    
    // Права на операции
    canCreateOperations: ['owner', 'admin', 'member'].includes(normalizedRole),
    canEditOwnOperations: ['owner', 'admin', 'member'].includes(normalizedRole),
    canEditAllOperations: ['owner', 'admin'].includes(normalizedRole),
    canDeleteOperations: ['owner', 'admin'].includes(normalizedRole),
    canViewOperations: ['owner', 'admin', 'member', 'viewer'].includes(normalizedRole),
    
    // Права на настройки
    canEditWorkspaceSettings: ['owner', 'admin'].includes(normalizedRole),
    canViewWorkspaceSettings: ['owner', 'admin'].includes(normalizedRole),
    canManageWorkspace: normalizedRole === 'owner',
    
    // Права на справочники (для будущих фаз)
    canEditDirectories: ['owner', 'admin'].includes(normalizedRole),
    canViewDirectories: ['owner', 'admin', 'member', 'viewer'].includes(normalizedRole),
    
    // Права на аналитику
    canViewAnalytics: ['owner', 'admin', 'member', 'viewer'].includes(normalizedRole),
    canExportData: ['owner', 'admin', 'member'].includes(normalizedRole),
    
    // Дополнительные проверки
    isOwner: normalizedRole === 'owner',
    isAdmin: normalizedRole === 'admin',
    isMember: normalizedRole === 'member',
    isViewer: normalizedRole === 'viewer',
    hasManagementRights: ['owner', 'admin'].includes(normalizedRole),
    hasEditRights: ['owner', 'admin', 'member'].includes(normalizedRole),
    
    // Права на выход/удаление
    canLeaveWorkspace: ['member', 'viewer'].includes(normalizedRole),
    canDeleteWorkspace: normalizedRole === 'owner'
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
  const normalizedRole = userRole?.toLowerCase();
  
  if (Array.isArray(roles)) {
    return roles.map(r => r.toLowerCase()).includes(normalizedRole);
  }
  
  return normalizedRole === roles.toLowerCase();
}

/**
 * Хук для проверки минимального уровня прав
 * @param {string} minRole Минимальная роль
 * @returns {boolean} Результат проверки
 */
export function useHasMinRole(minRole) {
  const { userRole } = useWorkspace();
  const normalizedRole = userRole?.toLowerCase();
  
  const roleHierarchy = {
    'viewer': 1,
    'member': 2,
    'admin': 3,
    'owner': 4
  };
  
  const userLevel = roleHierarchy[normalizedRole] || 0;
  const minLevel = roleHierarchy[minRole.toLowerCase()] || 0;
  
  return userLevel >= minLevel;
}