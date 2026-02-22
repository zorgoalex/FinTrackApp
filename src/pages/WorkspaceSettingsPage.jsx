import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Mail, Settings, Trash2, UserPlus, Shield, Crown, Eye, User, MinusCircle, RefreshCw } from 'lucide-react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { usePermissions } from '../hooks/usePermissions';

const roleIcons = {
  owner: Crown,
  admin: Shield,
  member: User,
  viewer: Eye,
  Owner: Crown,
  Admin: Shield,
  Member: User,
  Viewer: Eye
};

const roleLabels = {
  owner: 'Владелец',
  admin: 'Администратор', 
  member: 'Участник',
  viewer: 'Наблюдатель',
  Owner: 'Владелец',
  Admin: 'Администратор', 
  Member: 'Участник',
  Viewer: 'Наблюдатель'
};

const roleColors = {
  owner: 'text-yellow-600 bg-yellow-100',
  admin: 'text-purple-600 bg-purple-100',
  member: 'text-blue-600 bg-blue-100',
  viewer: 'text-gray-600 bg-gray-100',
  Owner: 'text-yellow-600 bg-yellow-100',
  Admin: 'text-purple-600 bg-purple-100',
  Member: 'text-blue-600 bg-blue-100',
  Viewer: 'text-gray-600 bg-gray-100'
};

export default function WorkspaceSettingsPage() {
  const navigate = useNavigate();
  const {
    currentWorkspace,
    userRole,
    workspaceMembers,
    pendingInvitations,
    loading,
    error,
    inviteUser,
    removeUser,
    resendInvitation,
    changeUserRole,
    deleteWorkspace,
    leaveWorkspace,
    cancelInvitation,
    canInviteUsers: canInviteUsersFromWorkspace,
    canManageRoles: canManageRolesFromWorkspace,
    canDeleteWorkspace: canDeleteWorkspaceFromWorkspace
  } = useWorkspace();
  
  const { 
    canManageRoles, 
    canInviteUsers, 
    canDeleteWorkspace,
    canLeaveWorkspace 
  } = usePermissions();

  // Используем значение из WorkspaceContext, так как там правильная логика
  const shouldShowInvitesTab = canInviteUsersFromWorkspace;

  const [activeTab, setActiveTab] = useState('general');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [isInviting, setIsInviting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [inviteError, setInviteError] = useState('');

  // Обработка отмены приглашения
  const handleCancelInvitation = async (invitationId, email) => {
    if (!confirm(`Вы уверены, что хотите отменить приглашение для ${email}?`)) {
      return;
    }
    try {
      await cancelInvitation(invitationId);
      alert('Приглашение отменено');
    } catch (err) {
      alert(err.message || 'Ошибка при отмене приглашения');
    }
  };

  // Обработка повторной отправки приглашения
  const handleResendInvitation = async (invitationId) => {
    setIsResending(true);
    try {
      await resendInvitation(invitationId);
      alert('Приглашение отправлено повторно');
    } catch (err) {
      alert(err.message || 'Ошибка при повторной отправке приглашения');
    } finally {
      setIsResending(false);
    }
  };

  // Обработка приглашения пользователя
  const handleInviteUser = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setIsInviting(true);
    setInviteError('');

    try {
      await inviteUser(inviteEmail.trim(), inviteRole);
      setInviteEmail('');
      setInviteRole('member');
      alert('Приглашение отправлено!');
    } catch (err) {
      setInviteError(err.message || 'Ошибка при отправке приглашения');
    } finally {
      setIsInviting(false);
    }
  };

  // Обработка удаления участника
  const handleRemoveUser = async (userId, userName) => {
    if (!confirm(`Вы уверены, что хотите исключить ${userName} из рабочего пространства?`)) {
      return;
    }

    try {
      await removeUser(userId);
      alert('Участник исключен из рабочего пространства');
    } catch (err) {
      alert(err.message || 'Ошибка при исключении участника');
    }
  };

  // Обработка изменения роли
  const handleChangeRole = async (userId, newRole, userName) => {
    if (!confirm(`Изменить роль ${userName} на ${roleLabels[newRole]}?`)) {
      return;
    }

    try {
      await changeUserRole(userId, newRole);
      alert('Роль участника изменена');
    } catch (err) {
      alert(err.message || 'Ошибка при изменении роли');
    }
  };

  // Обработка удаления workspace
  const handleDeleteWorkspace = async () => {
    const confirmText = currentWorkspace?.name || '';
    const userInput = prompt(
      `Это действие необратимо. Введите название пространства "${confirmText}" для подтверждения:`
    );

    if (userInput === confirmText) {
      try {
        await deleteWorkspace();
        alert('Рабочее пространство удалено');
        navigate('/workspaces');
      } catch (err) {
        alert(err.message || 'Ошибка при удалении рабочего пространства');
      }
    }
  };

  // Обработка выхода из workspace
  const handleLeaveWorkspace = async () => {
    if (confirm('Вы уверены, что хотите покинуть это рабочее пространство?')) {
      try {
        await leaveWorkspace();
        alert('Вы покинули рабочее пространство');
        navigate('/workspaces');
      } catch (err) {
        alert(err.message || 'Ошибка при выходе из рабочего пространства');
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Загрузка настроек...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button 
            onClick={() => navigate(-1)}
            className="btn btn-secondary"
          >
            Назад
          </button>
        </div>
      </div>
    );
  }

  if (!currentWorkspace) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Рабочее пространство не найдено</p>
          <button 
            onClick={() => navigate('/workspaces')}
            className="btn btn-primary"
          >
            К выбору пространств
          </button>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'general', label: 'Общие', icon: Settings },
    { id: 'members', label: 'Участники', icon: Users },
    ...(shouldShowInvitesTab ? [{ id: 'invites', label: 'Приглашения', icon: Mail }] : [])
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Заголовок */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Настройки рабочего пространства</h1>
          <p className="mt-2 text-sm text-gray-600">
            Управление настройками "{currentWorkspace.name}"
          </p>
        </div>

        {/* Табы */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon size={16} className="mr-2" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Содержимое табов */}
        <div className="space-y-6">
          {/* Общие настройки */}
          {activeTab === 'general' && (
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-medium mb-4">Информация о пространстве</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Название
                  </label>
                  <input
                    type="text"
                    value={currentWorkspace.name}
                    disabled
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Тип пространства
                  </label>
                  <p className="text-sm text-gray-600">
                    {currentWorkspace.is_personal ? 'Личное пространство' : 'Командное пространство'}
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Ваша роль
                  </label>
                  <div className="flex items-center">
                    {(() => {
                      const RoleIcon = roleIcons[userRole] || User;
                      return (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${roleColors[userRole]}`}>
                          <RoleIcon size={12} className="mr-1" />
                          {roleLabels[userRole]}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Опасная зона */}
              <div className="mt-8 pt-6 border-t border-gray-200">
                <h3 className="text-lg font-medium text-red-600 mb-4">Опасная зона</h3>
                <div className="space-y-3">
                  {canLeaveWorkspace && (
                    <button
                      onClick={handleLeaveWorkspace}
                      className="flex items-center px-4 py-2 border border-red-300 text-red-700 rounded-md hover:bg-red-50"
                    >
                      <User size={16} className="mr-2" />
                      Покинуть пространство
                    </button>
                  )}
                  
                  {canDeleteWorkspaceFromWorkspace && (
                    <button
                      onClick={handleDeleteWorkspace}
                      className="flex items-center px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                    >
                      <Trash2 size={16} className="mr-2" />
                      Удалить пространство
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Участники */}
          {activeTab === 'members' && (
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-medium mb-4">Участники ({workspaceMembers.length})</h2>
              
              <div className="space-y-3">
                {workspaceMembers.map((member) => {
                  const RoleIcon = roleIcons[member.role] || User;
                  const canManageThisMember = canManageRolesFromWorkspace && member.role.toLowerCase() !== 'owner';
                  
                  return (
                    <div key={member.user_id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium text-gray-700">
                            {member.email?.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {member.email}
                          </p>
                          <div className="flex items-center">
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${roleColors[member.role]}`}>
                              <RoleIcon size={10} className="mr-1" />
                              {roleLabels[member.role]}
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      {canManageThisMember && (
                        <div className="flex items-center space-x-2">
                          <select
                            value={member.role}
                            onChange={(e) => handleChangeRole(member.user_id, e.target.value, member.email)}
                            className="text-xs border border-gray-300 rounded px-2 py-1"
                          >
                            <option value="admin">Администратор</option>
                            <option value="member">Участник</option>
                            <option value="viewer">Наблюдатель</option>
                          </select>
                          
                          <button
                            onClick={() => handleRemoveUser(member.user_id, member.email)}
                            className="text-red-600 hover:text-red-800 p-1"
                            title="Исключить"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Приглашения */}
          {activeTab === 'invites' && shouldShowInvitesTab && (
            <div className="space-y-6">
              {/* Форма приглашения */}
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-lg font-medium mb-4">Пригласить участника</h2>
                
                <form onSubmit={handleInviteUser} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email адрес
                    </label>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="user@example.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Роль
                    </label>
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {canManageRolesFromWorkspace && <option value="admin">Администратор</option>}
                      <option value="member">Участник</option>
                      <option value="viewer">Наблюдатель</option>
                    </select>
                  </div>
                  
                  {inviteError && (
                    <p className="text-sm text-red-600">{inviteError}</p>
                  )}
                  
                  <button
                    type="submit"
                    disabled={isInviting}
                    className="btn btn-primary disabled:opacity-50"
                  >
                    <UserPlus size={16} className="mr-2" />
                    {isInviting ? 'Отправка...' : 'Отправить приглашение'}
                  </button>
                </form>
              </div>

              {/* Активные приглашения */}
              {pendingInvitations.length > 0 && (
                <div className="bg-white shadow rounded-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-medium">Активные приглашения ({pendingInvitations.length})</h2>
                    <button
                      onClick={() => navigate(`/workspace/${workspaceId}/settings/invites/history`)}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center"
                    >
                      История
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    {pendingInvitations.map((invitation) => (
                      <div key={invitation.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {invitation.invited_email}
                          </p>
                          <p className="text-xs text-gray-500">
                            Роль: {roleLabels[invitation.role]} • 
                            Отправлено: {new Date(invitation.invited_at).toLocaleDateString()}
                          </p>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full">
                            Ожидание
                          </span>
                          <button
                            onClick={() => handleResendInvitation(invitation.id)}
                            className="text-blue-600 hover:text-blue-800 p-1"
                            title="Отправить снова"
                            disabled={isResending}
                          >
                            <RefreshCw size={14} className={isResending ? 'animate-spin' : ''} />
                          </button>
                          <button
                            onClick={() => handleCancelInvitation(invitation.id, invitation.invited_email)}
                            className="text-red-600 hover:text-red-800 p-1"
                            title="Отменить приглашение"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}