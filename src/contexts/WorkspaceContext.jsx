import { createContext, useContext, useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from './AuthContext';
import { useAuth } from './AuthContext';

const WorkspaceContext = createContext({});

export function WorkspaceProvider({ children }) {
  const { workspaceId: workspaceIdFromParams } = useParams();
  const [searchParams] = useSearchParams();
  // Workspace ID can come from URL path (/workspace/:id) or from query param (?workspaceId=...)
  const workspaceId = workspaceIdFromParams || searchParams.get('workspaceId') || null;
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
          workspaces(id, name, is_personal, created_at)
        `)
        .eq('user_id', user.id)
        .eq('is_active', true);
      
      if (error) {
        console.error('WorkspaceContext: Error loading all workspaces', error);
        return;
      }

      const workspaceIds = (data || [])
        .map(item => item.workspace_id)
        .filter(Boolean);

      // Отдельно подтягиваем owner_id из workspaces для списка переключателя
      let ownersByWorkspaceId = {};
      if (workspaceIds.length > 0) {
        const { data: ownersData, error: ownersError } = await supabase
          .from('workspaces')
          .select('id, owner_id')
          .in('id', workspaceIds)
          .is('deleted_at', null);

        if (ownersError) {
          console.error('WorkspaceContext: Error loading workspace owners', ownersError);
        } else {
          ownersByWorkspaceId = (ownersData || []).reduce((acc, row) => {
            acc[row.id] = row.owner_id;
            return acc;
          }, {});
        }
      }

      const ownerIds = Array.from(new Set(Object.values(ownersByWorkspaceId).filter(Boolean)));
      let ownersByUserId = {};
      if (ownerIds.length > 0) {
        const emailPromises = ownerIds.map(id =>
          supabase.rpc('get_user_email', { user_id: id }).then(({ data }) => ({ id, email: data }))
        );
        const emailResults = await Promise.all(emailPromises);
        ownersByUserId = emailResults.reduce((acc, { id, email }) => {
          acc[id] = email || id;
          return acc;
        }, {});
      }
      
      const workspaces = data?.map(item => ({
        ...item.workspaces,
        owner_id: ownersByWorkspaceId[item.workspace_id] || null,
        ownerName: ownersByUserId[ownersByWorkspaceId[item.workspace_id]] || null,
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
      // 1. Загружаем данные участников workspace
      const { data: membersData, error: membersError } = await supabase
        .from('workspace_members')
        .select(`
          user_id,
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

      // 2. Загружаем email пользователей с fallback логикой
      let usersData = [];

      // Для текущего пользователя мы знаем email
      if (user && user.email) {
        usersData.push({ id: user.id, email: user.email });
      }

      // 3. Объединяем данные участников с email
      const membersWithEmails = membersData.map(member => {
        const userEmail = usersData?.find(user => user.id === member.user_id)?.email;
        const isCurrentUser = member.user_id === user?.id;
        
        let displayEmail;
        if (userEmail) {
          displayEmail = userEmail;
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

  const renameWorkspace = async (newName) => {
    if (!workspaceId || userRole?.toLowerCase() !== 'owner') {
      throw new Error('Только владелец может переименовывать пространство');
    }
    const trimmed = newName?.trim();
    if (!trimmed) throw new Error('Название не может быть пустым');

    const { error } = await supabase
      .from('workspaces')
      .update({ name: trimmed })
      .eq('id', workspaceId);

    if (error) throw error;

    // Обновить локальное состояние и список всех workspace
    setCurrentWorkspace((prev) => ({ ...prev, name: trimmed }));
    await loadAllWorkspaces();
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
    renameWorkspace,
    inviteUser,
    removeUser,
    changeUserRole,
    deleteWorkspace,
    leaveWorkspace,
    cancelInvitation
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
