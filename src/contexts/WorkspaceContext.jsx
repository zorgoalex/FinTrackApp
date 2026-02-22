import { createContext, useContext, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from './AuthContext';
import { useAuth } from './AuthContext';

const WorkspaceContext = createContext({});

export function WorkspaceProvider({ children }) {
  const { workspaceId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  // Основное состояние
  const [currentWorkspace, setCurrentWorkspace] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Мультипользователь состояние
  const [allWorkspaces, setAllWorkspaces] = useState([]);
  const [userRole, setUserRole] = useState(null);
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [pendingInvitations, setPendingInvitations] = useState([]);

  useEffect(() => {
    if (user) {
      loadAllWorkspaces();
      if (workspaceId) {
        loadWorkspace();
      } else {
        setCurrentWorkspace(null);
        setUserRole(null);
      }
    }
  }, [workspaceId, user]);

  const loadAllWorkspaces = async () => {
    if (!user) return;
    
    try {
      console.log('WorkspaceContext: Loading all workspaces for user', user.id);
      
      const { data, error } = await supabase
        .from('workspace_members')
        .select(`
          workspace_id,
          role,
          is_active,
          joined_at,
          last_accessed_at,
          workspaces(id, name, is_personal, created_at, owner_id)
        `)
        .eq('user_id', user.id)
        .eq('is_active', true);
      
      if (error) {
        console.error('WorkspaceContext: Error loading all workspaces', error);
        return;
      }
      
      const workspaces = data?.map(item => ({
        ...item.workspaces,
        userRole: item.role,
        joinedAt: item.joined_at,
        lastAccessedAt: item.last_accessed_at
      })) || [];
      
      console.log('WorkspaceContext: All workspaces loaded', workspaces);
      setAllWorkspaces(workspaces);
      
    } catch (err) {
      console.error('WorkspaceContext: Error loading all workspaces', err);
    }
  };

  const loadWorkspace = async () => {
    if (!user || !workspaceId) return;
    
    try {
      setLoading(true);
      setError('');
      console.log('WorkspaceContext: Loading workspace', { workspaceId, userId: user.id });
      
      // Проверить доступ через workspace_members
      const { data: memberData, error: memberError } = await supabase
        .from('workspace_members')
        .select('role, is_active')
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single();
      
      if (memberError) {
        console.error('WorkspaceContext: Member access error', memberError);
        setError('Нет доступа к рабочему пространству');
        return;
      }
      
      // Загрузить данные workspace
      const { data: workspaceData, error: workspaceError } = await supabase
        .from('workspaces')
        .select('*')
        .eq('id', workspaceId)
        .is('deleted_at', null)
        .single();
      
      if (workspaceError) {
        console.error('WorkspaceContext: Workspace load error', workspaceError);
        setError('Рабочее пространство не найдено');
        return;
      }
      
      const workspace = {
        ...workspaceData,
        userRole: memberData?.role || 'viewer'
      };
      
      console.log('WorkspaceContext: Workspace loaded', workspace);
      setCurrentWorkspace(workspace);
      setUserRole(memberData?.role || 'viewer');
      
      // Обновить время последнего доступа
      await updateLastAccessed();
      
      // Загрузить участников и приглашения если есть права
      const role = memberData?.role?.toLowerCase();
      if (['owner', 'admin'].includes(role)) {
        await loadWorkspaceMembers();
        await loadPendingInvitations();
      }
      
    } catch (err) {
      console.error('WorkspaceContext: Load error', err);
      setError('Ошибка загрузки рабочего пространства');
    } finally {
      setLoading(false);
    }
  };

  const loadWorkspaceMembers = async () => {
    if (!workspaceId) {
      console.log('WorkspaceContext: No workspaceId for loading members');
      return;
    }

    console.log('WorkspaceContext: Loading members for workspace', workspaceId);

    try {
      // Загружаем данные участников workspace вместе с email (из нового поля user_email)
      const { data: membersData, error: membersError } = await supabase
        .from('workspace_members')
        .select(`
          user_id,
          user_email,
          role,
          is_active,
          joined_at,
          last_accessed_at
        `)
        .eq('workspace_id', workspaceId)
        .eq('is_active', true);

      if (membersError) {
        console.error('WorkspaceContext: Error loading members', membersError);
        return;
      }

      if (!membersData || membersData.length === 0) {
        setWorkspaceMembers([]);
        return;
      }

      // Объединяем данные участников с email (используем user_email из БД)
      const membersWithEmails = membersData.map(member => {
        const isCurrentUser = member.user_id === user?.id;
        let displayEmail;

        if (member.user_email) {
          displayEmail = member.user_email;
        } else if (isCurrentUser) {
          displayEmail = user?.email || 'Вы';
        } else {
          displayEmail = `Участник (${member.user_id.slice(0, 8)})`;
        }

        return {
          ...member,
          email: displayEmail
        };
      });

      setWorkspaceMembers(membersWithEmails);

    } catch (err) {
      console.error('WorkspaceContext: Error loading members', err);
      setWorkspaceMembers([]);
    }
  };

  const loadPendingInvitations = async () => {
    if (!workspaceId) return;
    
    try {
      const { data, error } = await supabase
        .from('workspace_invitations')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('status', 'pending');
      
      if (error) {
        console.error('WorkspaceContext: Error loading invitations', error);
        return;
      }
      
      setPendingInvitations(data || []);
    } catch (err) {
      console.error('WorkspaceContext: Error loading invitations', err);
    }
  };

  const updateLastAccessed = async () => {
    if (!user || !workspaceId) return;
    
    try {
      await supabase
        .from('workspace_members')
        .update({ last_accessed_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id);
    } catch (err) {
      console.error('WorkspaceContext: Error updating last accessed', err);
    }
  };

  // Функции управления workspace
  const switchWorkspace = async (newWorkspaceId) => {
    try {
      console.log('WorkspaceContext: Switching to workspace', newWorkspaceId);
      
      // Сохранить выбор в localStorage
      localStorage.setItem('lastWorkspaceId', newWorkspaceId);
      
      // Перейти на новый workspace
      navigate(`/workspace/${newWorkspaceId}`);
      
    } catch (err) {
      console.error('WorkspaceContext: Error switching workspace', err);
    }
  };

  const inviteUser = async (email, role) => {
    if (!workspaceId || !['owner', 'admin'].includes(userRole?.toLowerCase())) {
      throw new Error('Недостаточно прав для приглашения пользователей');
    }

    try {
      // Invoke the 'invite-user' Edge Function
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: {
          workspaceId: workspaceId,
          email: email,
          role: role,
        },
      });

      if (error) {
        // The function might return a specific error message from its response
        const errorMessage = error.context?.errorMessage || error.message;
        throw new Error(errorMessage);
      }

      // Refresh the list of pending invitations
      await loadPendingInvitations();
      
      return data;
    } catch (err) {
      console.error('WorkspaceContext: Error inviting user', err);
      // Re-throw the error so the UI can catch it and display it
      throw err;
    }
  };

  const removeUser = async (userId) => {
    if (!workspaceId || userRole?.toLowerCase() !== 'owner') {
      throw new Error('Только владелец может исключать участников');
    }

    try {
      const { error } = await supabase
        .from('workspace_members')
        .update({ is_active: false })
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId);

      if (error) throw error;

      // Обновить список участников
      await loadWorkspaceMembers();
      
    } catch (err) {
      console.error('WorkspaceContext: Error removing user', err);
      throw err;
    }
  };

  const changeUserRole = async (userId, newRole) => {
    if (!workspaceId || userRole?.toLowerCase() !== 'owner') {
      throw new Error('Только владелец может изменять роли');
    }

    try {
      const { error } = await supabase
        .from('workspace_members')
        .update({ role: newRole })
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId);

      if (error) throw error;

      // Обновить список участников
      await loadWorkspaceMembers();
      
    } catch (err) {
      console.error('WorkspaceContext: Error changing user role', err);
      throw err;
    }
  };

  const deleteWorkspace = async () => {
    if (!workspaceId || userRole?.toLowerCase() !== 'owner') {
      throw new Error('Только владелец может удалить рабочее пространство');
    }

    try {
      const { error } = await supabase
        .from('workspaces')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', workspaceId);

      if (error) throw error;

      // Перейти к выбору workspace
      navigate('/workspaces');
      
    } catch (err) {
      console.error('WorkspaceContext: Error deleting workspace', err);
      throw err;
    }
  };

  const leaveWorkspace = async () => {
    if (!workspaceId || !['member', 'viewer'].includes(userRole?.toLowerCase())) {
      throw new Error('Только участники и наблюдатели могут покинуть пространство');
    }

    try {
      const { error } = await supabase
        .from('workspace_members')
        .update({ is_active: false })
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id);

      if (error) throw error;

      // Перейти к выбору workspace
      navigate('/workspaces');
      
    } catch (err) {
      console.error('WorkspaceContext: Error leaving workspace', err);
      throw err;
    }
  };

  const cancelInvitation = async (invitationId) => {
    if (!workspaceId || !['owner', 'admin'].includes(userRole?.toLowerCase())) {
      throw new Error('Недостаточно прав для отмены приглашений');
    }

    try {
      const { error } = await supabase
        .from('workspace_invitations')
        .delete()
        .eq('id', invitationId);

      if (error) throw error;

      // Refresh the list of pending invitations
      await loadPendingInvitations();

    } catch (err) {
      console.error('WorkspaceContext: Error canceling invitation', err);
      throw new Error('Ошибка при отмене приглашения');
    }
  };

  const resendInvitation = async (invitationId) => {
    if (!workspaceId || !['owner', 'admin'].includes(userRole?.toLowerCase())) {
      throw new Error('Недостаточно прав для повторной отправки приглашений');
    }

    try {
      // Проверить что приглашение существует и в статусе pending
      const { data: invitation, error: fetchError } = await supabase
        .from('workspace_invitations')
        .select('*')
        .eq('id', invitationId)
        .single();

      if (fetchError || !invitation) {
        throw new Error('Приглашение не найдено');
      }

      if (invitation.status !== 'pending') {
        throw new Error('Можно повторно отправить только ожидающие приглашения');
      }

      if (invitation.email_sent_count >= 3) {
        throw new Error('Превышен лимит повторных отправок (максимум 3)');
      }

      // Обновить expires_at (+7 дней от текущей даты)
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 7);

      // Вызвать invite-user Edge Function для повторной отправки
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: {
          workspaceId: workspaceId,
          email: invitation.invited_email,
          role: invitation.role,
          invitationId: invitationId, // Для обновления существующего приглашения
        },
      });

      if (error) {
        const errorMessage = error.context?.errorMessage || error.message;
        throw new Error(errorMessage);
      }

      // Refresh the list of pending invitations
      await loadPendingInvitations();

      return data;
    } catch (err) {
      console.error('WorkspaceContext: Error resending invitation', err);
      throw err;
    }
  };

  // Проверки прав
  const canInviteUsers = ['owner', 'admin'].includes(userRole?.toLowerCase());
  const canManageRoles = userRole?.toLowerCase() === 'owner';
  const canDeleteWorkspace = userRole?.toLowerCase() === 'owner';
  const canEditOperations = ['owner', 'admin', 'member'].includes(userRole?.toLowerCase());
  const canViewOperations = ['owner', 'admin', 'member', 'viewer'].includes(userRole?.toLowerCase());


  const value = {
    // Основное состояние
    currentWorkspace,
    loading,
    error,
    workspaceId,
    
    // Мультипользователь состояние
    allWorkspaces,
    userRole,
    workspaceMembers,
    pendingInvitations,
    
    // Проверки прав
    canInviteUsers,
    canManageRoles,
    canDeleteWorkspace,
    canEditOperations,
    canViewOperations,
    
    // Функции
    refreshWorkspace: loadWorkspace,
    refreshAllWorkspaces: loadAllWorkspaces,
    switchWorkspace,
    inviteUser,
    removeUser,
    changeUserRole,
    deleteWorkspace,
    leaveWorkspace,
    cancelInvitation,
    resendInvitation
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}