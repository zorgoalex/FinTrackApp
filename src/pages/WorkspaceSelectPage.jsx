import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { supabase } from '../contexts/AuthContext';
import { useAuth } from '../contexts/AuthContext';

export default function WorkspaceSelectPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');

  useEffect(() => {
    loadWorkspaces();
  }, [user]);

  const loadWorkspaces = async () => {
    if (!user) {
      console.log('WorkspaceSelectPage: No user found');
      return;
    }
    
    try {
      setLoading(true);
      console.log('WorkspaceSelectPage: Loading workspaces for user', user.id);
      
      const { data, error } = await supabase
        .from('workspace_members')
        .select(`
          workspace_id,
          role,
          workspaces(name, is_personal, deleted_at)
        `)
        .eq('user_id', user.id);
      
      console.log('WorkspaceSelectPage: Raw data from DB', { data, error });
      
      if (error) throw error;
      
      // Фильтруем только активные workspace'ы (без мягкого удаления)
      const activeWorkspaces = data?.filter(item => 
        item.workspaces && !item.workspaces.deleted_at
      ) || [];
      
      console.log('WorkspaceSelectPage: Active workspaces', activeWorkspaces);
      
      setWorkspaces(activeWorkspaces);
      
      // Если у пользователя только одно рабочее пространство, перейти в него автоматически
      if (activeWorkspaces.length === 1) {
        console.log('WorkspaceSelectPage: Auto-navigating to workspace', activeWorkspaces[0].workspace_id);
        navigate(`/workspace/${activeWorkspaces[0].workspace_id}`);
      }
    } catch (err) {
      console.error('Error loading workspaces:', err);
      setError('Не удалось загрузить рабочие пространства');
    } finally {
      setLoading(false);
    }
  };

  const createWorkspace = async (e) => {
    e.preventDefault();
    if (!newWorkspaceName.trim() || !user) return;
    
    try {
      setCreating(true);
      setError('');
      
      const { data, error } = await supabase
        .from('workspaces')
        .insert({
          name: newWorkspaceName.trim(),
          owner_id: user.id,
          is_personal: false
        })
        .select()
        .single();
      
      if (error) throw error;
      
      // Добавить пользователя как владельца нового workspace
      await supabase
        .from('workspace_members')
        .insert({
          workspace_id: data.id,
          user_id: user.id,
          role: 'Owner'
        });
      
      setNewWorkspaceName('');
      await loadWorkspaces();
    } catch (err) {
      console.error('Error creating workspace:', err);
      setError('Не удалось создать рабочее пространство');
    } finally {
      setCreating(false);
    }
  };

  const selectWorkspace = (workspaceId) => {
    navigate(`/workspace/${workspaceId}`);
  };

  const openSettings = (e, workspaceId) => {
    e.stopPropagation(); // Предотвращаем выбор workspace при клике на настройки
    navigate(`/workspace/${workspaceId}/settings`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 dark:border-primary-400 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Загрузка рабочих пространств...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="card w-full max-w-md text-center">
          <div className="text-red-600 mb-4">{error}</div>
          <button 
            onClick={loadWorkspaces}
            className="btn-primary"
          >
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
      <div className="card w-full max-w-md">
        <h1 className="text-2xl font-semibold mb-6 text-center">Выберите рабочее пространство</h1>
        
        {workspaces.length === 0 ? (
          <div className="text-center text-gray-600 dark:text-gray-400 mb-6">
            У вас еще нет рабочих пространств. Создайте первое!
          </div>
        ) : (
          <div className="space-y-3 mb-6">
            {workspaces.map((workspace) => (
              <div
                key={workspace.workspace_id}
                className="relative border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <button
                  onClick={() => selectWorkspace(workspace.workspace_id)}
                  className="w-full p-4 text-left pr-12"
                >
                  <div className="font-medium">{workspace.workspaces.name}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {workspace.workspaces.is_personal ? 'Личное' : 'Общее'} • {workspace.role}
                  </div>
                </button>
                
                {/* Кнопка настроек */}
                {(workspace.role === 'Owner' || workspace.role === 'Admin') && (
                  <button
                    onClick={(e) => openSettings(e, workspace.workspace_id)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 p-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                    title="Настройки workspace"
                  >
                    <Settings size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        
        <form onSubmit={createWorkspace} className="space-y-3">
          <h2 className="text-lg font-medium mb-3 text-gray-900 dark:text-gray-100">Создать новое рабочее пространство</h2>
          <input
            type="text"
            className="input-field"
            placeholder="Название рабочего пространства"
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            required
          />
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={creating || !newWorkspaceName.trim()}
          >
            {creating ? 'Создаём...' : 'Создать'}
          </button>
        </form>
        
        <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          <button 
            onClick={() => {
              supabase.auth.signOut();
              navigate('/login');
            }}
            className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
          >
            Выйти из аккаунта
          </button>
        </div>
      </div>
    </div>
  );
}