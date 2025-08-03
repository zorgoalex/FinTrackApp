import { createContext, useContext, useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from './AuthContext';
import { useAuth } from './AuthContext';

const WorkspaceContext = createContext({});

export function WorkspaceProvider({ children }) {
  const { workspaceId } = useParams();
  const { user } = useAuth();
  const [currentWorkspace, setCurrentWorkspace] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (workspaceId && user) {
      loadWorkspace();
    } else {
      setCurrentWorkspace(null);
    }
  }, [workspaceId, user]);

  const loadWorkspace = async () => {
    if (!user || !workspaceId) return;
    
    try {
      setLoading(true);
      setError('');
      console.log('WorkspaceContext: Loading workspace', { workspaceId, userId: user.id });
      
      // Проверить доступ через workspace_members
      const { data: memberData, error: memberError } = await supabase
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id)
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
        userRole: memberData?.role || 'Viewer'
      };
      
      console.log('WorkspaceContext: Workspace loaded', workspace);
      setCurrentWorkspace(workspace);
      
    } catch (err) {
      console.error('WorkspaceContext: Load error', err);
      setError('Ошибка загрузки рабочего пространства');
    } finally {
      setLoading(false);
    }
  };

  const value = {
    currentWorkspace,
    loading,
    error,
    workspaceId,
    refreshWorkspace: loadWorkspace
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