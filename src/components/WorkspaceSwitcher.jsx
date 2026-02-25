import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Building2, Plus, Users, Crown, Cog, Eye, User } from 'lucide-react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const roleIcons = {
  owner: Crown,
  admin: Cog,
  member: User,
  viewer: Eye
};

const roleLabels = {
  owner: 'Владелец',
  admin: 'Администратор',
  member: 'Участник',
  viewer: 'Наблюдатель'
};

const roleColors = {
  owner: 'text-yellow-600',
  admin: 'text-purple-600',
  member: 'text-blue-600',
  viewer: 'text-gray-600'
};

export default function WorkspaceSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const {
    currentWorkspace,
    allWorkspaces,
    switchWorkspace,
    loading,
    workspaceId
  } = useWorkspace();

  // Закрытие при клике вне компонента
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Фильтрация workspace по поиску
  const filteredWorkspaces = (allWorkspaces || []).filter(workspace =>
    workspace.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleWorkspaceSelect = async (workspaceId) => {
    setIsOpen(false);
    setSearchTerm('');
    await switchWorkspace(workspaceId);
  };

  const handleCreateNew = () => {
    setIsOpen(false);
    navigate('/workspaces/create');
  };

  const getWorkspaceRole = (workspace) => {
    const rawRole = workspace?.userRole || workspace?.role;
    if (rawRole) return String(rawRole).toLowerCase();

    if (workspace?.owner_id && workspace.owner_id === user?.id) return 'owner';
    if (workspace?.is_personal) return 'owner';

    return 'member';
  };

  const getOwnerDisplay = (workspace) => {
    if (!workspace) return '';
    return workspace.ownerName || workspace.ownerEmail || workspace.owner_id || '';
  };

  if (!currentWorkspace) {
    // If we have a workspaceId (from URL) or loading, the workspace is being loaded — show spinner
    // This prevents the "Выбрать пространство" button from flashing during workspace transitions,
    // which on mobile could catch a phantom touch event and redirect to /workspaces.
    if (loading || workspaceId) {
      return (
        <div className="flex items-center space-x-2 px-3 py-2 bg-gray-100 rounded-md animate-pulse">
          <Building2 size={16} className="text-gray-400" />
          <span className="text-sm text-gray-500">Загрузка...</span>
        </div>
      );
    }

    return (
      <button
        onClick={() => navigate('/workspaces')}
        className="flex items-center space-x-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
      >
        <Building2 size={16} className="text-blue-600" />
        <span className="text-sm text-blue-700">Выбрать пространство</span>
      </button>
    );
  }

  const currentWorkspaceRole = getWorkspaceRole(currentWorkspace);
  const RoleIcon = roleIcons[currentWorkspaceRole] || User;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Кнопка переключателя */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-3 py-2 bg-white hover:bg-gray-50 border border-gray-200 rounded-md transition-colors min-w-48"
      >
        <Building2 size={16} className="text-gray-600" />
        <div className="flex-1 text-left">
          <div className="text-sm font-medium text-gray-900 truncate">
            {currentWorkspace.name}
          </div>
          <div className={`text-xs ${roleColors[currentWorkspaceRole]} flex items-center`}>
            <RoleIcon size={12} className="mr-1" />
            {roleLabels[currentWorkspaceRole] || roleLabels.member}
          </div>
        </div>
        <ChevronDown 
          size={16} 
          className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
        />
      </button>

      {/* Выпадающий список */}
      {isOpen && (
        <div
          className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-50"
          onClick={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          {/* Поиск */}
          {(allWorkspaces || []).length > 3 && (
            <div className="p-3 border-b border-gray-100">
              <input
                type="text"
                placeholder="Поиск пространств..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
            </div>
          )}

          {/* Список workspace */}
          <div className="max-h-64 overflow-y-auto">
            {filteredWorkspaces.length > 0 ? (
              filteredWorkspaces.map((workspace) => {
                const workspaceRole = getWorkspaceRole(workspace);
                const WorkspaceRoleIcon = roleIcons[workspaceRole] || User;
                const isActive = workspace.id === currentWorkspace.id;
                const isForeignWorkspace = workspaceRole !== 'owner';
                const ownerDisplay = getOwnerDisplay(workspace);
                
                return (
                  <button
                    key={workspace.id}
                    onClick={() => handleWorkspaceSelect(workspace.id)}
                    className={`w-full flex items-center space-x-3 px-3 py-3 text-left transition-colors border-l-2 ${
                      isForeignWorkspace
                        ? 'bg-blue-50 border-blue-300 hover:bg-blue-100'
                        : 'bg-white border-transparent hover:bg-gray-50'
                    } ${isActive ? 'border-r-2 border-r-blue-500' : ''}`}
                  >
                    <Building2 
                      size={16} 
                      className={isActive ? 'text-blue-600' : 'text-gray-400'} 
                    />
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm ${workspaceRole === 'owner' ? 'font-bold' : 'font-medium'} truncate ${
                        isActive ? 'text-blue-900' : 'text-gray-900'
                      }`}>
                        {workspace.name}
                        {workspace.is_personal && (
                          <span className="ml-2 text-xs text-gray-500">(Личное)</span>
                        )}
                      </div>
                      <div className={`text-xs flex items-center ${roleColors[workspaceRole] || roleColors.member}`}>
                        <WorkspaceRoleIcon size={10} className="mr-1" />
                        {roleLabels[workspaceRole] || roleLabels.member}
                      </div>
                      {isForeignWorkspace && ownerDisplay && (
                        <div className="text-xs text-gray-500 truncate">
                          Владелец: {ownerDisplay}
                        </div>
                      )}
                    </div>
                    {isActive && (
                      <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                    )}
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-4 text-sm text-gray-500 text-center">
                {searchTerm ? 'Пространства не найдены' : 'Нет доступных пространств'}
              </div>
            )}
          </div>

          {/* Действия */}
          <div className="border-t border-gray-100 p-2">
            <button
              onClick={handleCreateNew}
              className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
            >
              <Plus size={16} />
              <span>Создать новое пространство</span>
            </button>
            
            <button
              onClick={() => {
                setIsOpen(false);
                navigate('/workspaces');
              }}
              className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-md transition-colors"
            >
              <Users size={16} />
              <span>Управление пространствами</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
