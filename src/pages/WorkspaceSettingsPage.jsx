import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Mail, Settings, Trash2, UserPlus, Shield, Crown, Eye, User, Coins, Download, Sparkles } from 'lucide-react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { supabase } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import ExchangeRateManager from '../components/ExchangeRateManager';
import { createWorkspaceBackup, downloadWorkspaceBackup } from '../utils/workspaceBackup';

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
    changeUserRole,
    deleteWorkspace,
    leaveWorkspace,
    cancelInvitation,
    renameWorkspace,
    updateBaseCurrency,
    canInviteUsers: canInviteUsersFromWorkspace,
    canManageRoles: canManageRolesFromWorkspace,
    canDeleteWorkspace: canDeleteWorkspaceFromWorkspace
  } = useWorkspace();
  
  const { canLeaveWorkspace, canEditWorkspaceSettings } = usePermissions();

  // Используем значение из WorkspaceContext, так как там правильная логика
  const shouldShowInvitesTab = canInviteUsersFromWorkspace;

  const [activeTab, setActiveTab] = useState('general');
  const [workspaceName, setWorkspaceName] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [renameSuccess, setRenameSuccess] = useState(false);
  const [currencies, setCurrencies] = useState([]);
  const [currencyLoading, setCurrencyLoading] = useState(false);
  const [currencySuccess, setCurrencySuccess] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupError, setBackupError] = useState('');
  const [aiPolicies, setAiPolicies] = useState([]);
  const [aiPoliciesLoading, setAiPoliciesLoading] = useState(false);
  const [aiPoliciesError, setAiPoliciesError] = useState('');
  const [aiPoliciesSaved, setAiPoliciesSaved] = useState(false);

  // Синхронизировать локальное название с загруженным workspace
  useEffect(() => {
    if (currentWorkspace?.name) setWorkspaceName(currentWorkspace.name);
  }, [currentWorkspace?.name]);

  // Загрузить список валют
  useEffect(() => {
    supabase.from('currencies').select('code, name_ru, symbol').eq('is_active', true)
      .order('name_ru')
      .then(({ data }) => setCurrencies(data || []));
  }, []);

  useEffect(() => {
    if (!currentWorkspace?.id) return;
    setAiPoliciesLoading(true);
    supabase.from('ai_access_policies')
      .select('workspace_id, role, enabled, data_scope, include_accounts, include_categories, include_descriptions')
      .eq('workspace_id', currentWorkspace.id)
      .order('role')
      .then(({ data, error: policyError }) => {
        if (policyError) setAiPoliciesError(policyError.message);
        else setAiPolicies(data || []);
        setAiPoliciesLoading(false);
      });
  }, [currentWorkspace?.id]);

  const updateAiPolicy = (role, changes) => {
    setAiPoliciesSaved(false);
    setAiPolicies((current) => current.map((policy) => policy.role === role ? { ...policy, ...changes } : policy));
  };

  const saveAiPolicies = async () => {
    setAiPoliciesLoading(true);
    setAiPoliciesError('');
    setAiPoliciesSaved(false);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const { error: saveError } = await supabase.from('ai_access_policies').upsert(
        aiPolicies.map((policy) => ({ ...policy, updated_at: new Date().toISOString(), updated_by: authData?.user?.id || null })),
        { onConflict: 'workspace_id,role' },
      );
      if (saveError) throw saveError;
      setAiPoliciesSaved(true);
    } catch (policyError) {
      setAiPoliciesError(policyError.message || 'Не удалось сохранить правила AI');
    } finally {
      setAiPoliciesLoading(false);
    }
  };

  const handleRename = async (e) => {
    e.preventDefault();
    if (workspaceName.trim() === currentWorkspace?.name) return;
    setRenameLoading(true);
    setRenameError('');
    setRenameSuccess(false);
    try {
      await renameWorkspace(workspaceName);
      setRenameSuccess(true);
      setTimeout(() => setRenameSuccess(false), 2500);
    } catch (err) {
      setRenameError(err.message || 'Ошибка переименования');
    } finally {
      setRenameLoading(false);
    }
  };

  const handleCurrencyChange = async (e) => {
    const newCode = e.target.value;
    setCurrencyLoading(true);
    setCurrencySuccess(false);
    try {
      await updateBaseCurrency(newCode);
      setCurrencySuccess(true);
      setTimeout(() => setCurrencySuccess(false), 2500);
    } catch (err) {
      alert(err.message || 'Ошибка при изменении валюты');
    } finally {
      setCurrencyLoading(false);
    }
  };

  const handleDownloadBackup = async () => {
    setBackupLoading(true);
    setBackupError('');
    try {
      const backup = await createWorkspaceBackup(supabase, currentWorkspace.id);
      downloadWorkspaceBackup(backup);
    } catch (backupException) {
      console.error('WorkspaceSettingsPage: backup error', backupException);
      setBackupError(backupException.message || 'Не удалось создать резервную копию');
    } finally {
      setBackupLoading(false);
    }
  };

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteLink, setInviteLink] = useState(''); // ссылка если email не доставлен

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

  // Обработка приглашения пользователя
  const handleInviteUser = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setIsInviting(true);
    setInviteError('');

    try {
      const result = await inviteUser(inviteEmail.trim(), inviteRole);
      setInviteEmail('');
      setInviteRole('member');
      setInviteLink('');
      if (result?.email_warning) {
        // Email не доставлен (sandbox / неверифицированный домен) — показываем ссылку
        setInviteError(`⚠️ Email не отправлен (Resend sandbox). Поделитесь ссылкой вручную:`);
        setInviteLink(result.accept_url || '');
      } else {
        alert('Приглашение отправлено!');
      }
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
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 dark:border-primary-400 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Загрузка настроек...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
          <button
            onClick={() => navigate(-1)}
            className="btn-secondary"
          >
            Назад
          </button>
        </div>
      </div>
    );
  }

  if (!currentWorkspace) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400 mb-4">Рабочее пространство не найдено</p>
          <button
            onClick={() => navigate('/workspaces')}
            className="btn-primary"
          >
            К выбору пространств
          </button>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'general', label: 'Общие', icon: Settings },
    { id: 'currency', label: 'Валюта', icon: Coins },
    { id: 'members', label: 'Участники', icon: Users },
    ...(canEditWorkspaceSettings ? [{ id: 'ai', label: 'AI-доступ', icon: Sparkles }] : []),
    ...(shouldShowInvitesTab ? [{ id: 'invites', label: 'Приглашения', icon: Mail }] : [])
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8" data-testid="settings-page">
        {/* Заголовок */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Настройки рабочего пространства</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Управление настройками «{currentWorkspace.name}»
          </p>
        </div>

        {/* Табы */}
        <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
          <nav className="-mb-px flex gap-6 overflow-x-auto" data-testid="settings-tabs">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  data-testid={`settings-tab-${tab.id}`}
                  className={`flex items-center py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === tab.id
                      ? 'border-primary-500 dark:border-primary-400 text-primary-600 dark:text-primary-400'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
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
            <div className="bg-white dark:bg-gray-800 shadow-md rounded-xl p-6">
              <h2 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Информация о пространстве</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Название
                  </label>
                  {userRole?.toLowerCase() === 'owner' ? (
                    <form onSubmit={handleRename} className="flex gap-2">
                      <input
                        type="text"
                        value={workspaceName}
                        onChange={(e) => { setWorkspaceName(e.target.value); setRenameSuccess(false); setRenameError(''); }}
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                        maxLength={80}
                      />
                      <button
                        type="submit"
                        disabled={renameLoading || workspaceName.trim() === currentWorkspace?.name || !workspaceName.trim()}
                        className="px-4 py-2 bg-primary-600 dark:bg-primary-500 hover:bg-primary-700 dark:hover:bg-primary-600 text-white text-sm rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {renameLoading ? '...' : 'Сохранить'}
                      </button>
                    </form>
                  ) : (
                    <input
                      type="text"
                      value={currentWorkspace.name}
                      disabled
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-400"
                    />
                  )}
                  {renameError   && <p className="text-sm text-red-600 mt-1">{renameError}</p>}
                  {renameSuccess && <p className="text-sm text-green-600 mt-1">✓ Название обновлено</p>}
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Тип пространства
                  </label>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {currentWorkspace.is_personal ? 'Личное пространство' : 'Командное пространство'}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Валюта
                  </label>
                  {userRole?.toLowerCase() === 'owner' ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={currentWorkspace.base_currency || 'KZT'}
                        onChange={handleCurrencyChange}
                        disabled={currencyLoading}
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                      >
                        {currencies.map(c => (
                          <option key={c.code} value={c.code}>{c.symbol} {c.name_ru} ({c.code})</option>
                        ))}
                      </select>
                      {currencySuccess && <span className="text-sm text-green-600">&#10003;</span>}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {currencies.find(c => c.code === (currentWorkspace.base_currency || 'KZT'))
                        ? `${currencies.find(c => c.code === currentWorkspace.base_currency).symbol} ${currencies.find(c => c.code === currentWorkspace.base_currency).name_ru}`
                        : currentWorkspace.base_currency || 'KZT'}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">Резервная копия</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Скачайте финансовые данные пространства в JSON для хранения или будущей миграции.
                </p>
                {backupError && (
                  <p className="text-sm text-red-600 dark:text-red-400 mb-3">{backupError}</p>
                )}
                <button
                  type="button"
                  onClick={handleDownloadBackup}
                  disabled={backupLoading}
                  className="btn-secondary disabled:opacity-50"
                >
                  <Download size={16} className="mr-2" />
                  {backupLoading ? 'Создаём копию...' : 'Скачать резервную копию'}
                </button>
              </div>

              {/* Опасная зона */}
              <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-medium text-red-600 dark:text-red-400 mb-4">Опасная зона</h3>
                <div className="space-y-3">
                  {canLeaveWorkspace && (
                    <button
                      onClick={handleLeaveWorkspace}
                      className="flex items-center px-4 py-2 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-900/30"
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

          {/* Валюта и курсы */}
          {activeTab === 'currency' && (
            <div className="bg-white dark:bg-gray-800 shadow-md rounded-xl p-6 space-y-6">
              <div>
                <h2 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Базовая валюта</h2>
                {userRole?.toLowerCase() === 'owner' ? (
                  <div className="flex items-center gap-2">
                    <select
                      value={currentWorkspace.base_currency || 'KZT'}
                      onChange={handleCurrencyChange}
                      disabled={currencyLoading}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                    >
                      {currencies.map(c => (
                        <option key={c.code} value={c.code}>{c.symbol} {c.name_ru} ({c.code})</option>
                      ))}
                    </select>
                    {currencySuccess && <span className="text-sm text-green-600">&#10003;</span>}
                  </div>
                ) : (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {currencies.find(c => c.code === (currentWorkspace.base_currency || 'KZT'))
                      ? `${currencies.find(c => c.code === currentWorkspace.base_currency).symbol} ${currencies.find(c => c.code === currentWorkspace.base_currency).name_ru}`
                      : currentWorkspace.base_currency || 'KZT'}
                  </p>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Все суммы в аналитике и сводке пересчитываются в базовую валюту.
                </p>
              </div>

              <hr className="border-gray-200 dark:border-gray-700" />

              <ExchangeRateManager
                workspaceId={currentWorkspace.id}
                baseCurrency={currentWorkspace.base_currency || 'KZT'}
              />
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-4 rounded-xl bg-white p-4 shadow-md dark:bg-gray-800 sm:p-6">
              <div>
                <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">Доступ AI-ассистента по ролям</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Эти правила применяются в базе до передачи данных модели. Ассистент всегда работает только на чтение.</p>
              </div>
              {aiPoliciesError && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">{aiPoliciesError}</p>}
              {aiPoliciesLoading && aiPolicies.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">Загрузка правил…</p>
              ) : (
                <div className="space-y-3">
                  {aiPolicies.map((policy) => (
                    <div key={policy.role} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-gray-900 dark:text-gray-100">{roleLabels[policy.role] || policy.role}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">Правило действует для всех пользователей этой роли</p>
                        </div>
                        <label className="flex min-h-11 items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                          <input type="checkbox" checked={policy.enabled} onChange={(event) => updateAiPolicy(policy.role, { enabled: event.target.checked })} className="h-5 w-5 rounded border-gray-300 text-primary-600" />
                          Разрешить
                        </label>
                      </div>
                      <div className={`mt-3 grid gap-3 sm:grid-cols-2 ${policy.enabled ? '' : 'pointer-events-none opacity-50'}`}>
                        <label className="text-xs text-gray-600 dark:text-gray-400">Какие операции доступны
                          <select value={policy.data_scope} onChange={(event) => updateAiPolicy(policy.role, { data_scope: event.target.value })} className="input-field mt-1 min-h-11 w-full">
                            <option value="aggregate">Только общие суммы</option>
                            <option value="own_detail">Сводка и свои операции</option>
                            <option value="workspace_detail">Все операции пространства</option>
                          </select>
                        </label>
                        <div className="grid grid-cols-1 gap-1 text-sm text-gray-700 dark:text-gray-300">
                          <label className="flex min-h-8 items-center gap-2"><input type="checkbox" checked={policy.include_categories} onChange={(event) => updateAiPolicy(policy.role, { include_categories: event.target.checked })} /> Категории</label>
                          <label className="flex min-h-8 items-center gap-2"><input type="checkbox" checked={policy.include_accounts} onChange={(event) => updateAiPolicy(policy.role, { include_accounts: event.target.checked })} /> Счета и остатки</label>
                          <label className={`flex min-h-8 items-center gap-2 ${policy.data_scope === 'aggregate' ? 'opacity-50' : ''}`}><input type="checkbox" disabled={policy.data_scope === 'aggregate'} checked={policy.include_descriptions} onChange={(event) => updateAiPolicy(policy.role, { include_descriptions: event.target.checked })} /> Описания операций</label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-end gap-3">
                {aiPoliciesSaved && <span className="text-sm text-green-600 dark:text-green-400">Правила сохранены</span>}
                <button type="button" onClick={saveAiPolicies} disabled={aiPoliciesLoading || aiPolicies.length === 0} className="btn-primary min-h-11 disabled:opacity-50">Сохранить правила</button>
              </div>
            </div>
          )}

          {/* Участники */}
          {activeTab === 'members' && (
            <div className="bg-white dark:bg-gray-800 shadow-md rounded-xl p-6">
              <h2 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Участники ({workspaceMembers.length})</h2>
              
              <div className="space-y-3">
                {workspaceMembers.map((member) => {
                  const RoleIcon = roleIcons[member.role] || User;
                  const canManageThisMember = canManageRolesFromWorkspace && member.role.toLowerCase() !== 'owner';
                  
                  return (
                    <div key={member.user_id} className="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-700 rounded-xl">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {member.email?.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
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
                            value={member.role.toLowerCase()}
                            onChange={(e) => handleChangeRole(member.user_id, e.target.value, member.email)}
                            className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
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
              <div className="bg-white dark:bg-gray-800 shadow-md rounded-xl p-6">
                <h2 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Пригласить участника</h2>

                <form onSubmit={handleInviteUser} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Email адрес
                    </label>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="user@example.com"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Роль
                    </label>
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {canManageRolesFromWorkspace && <option value="admin">Администратор</option>}
                      <option value="member">Участник</option>
                      <option value="viewer">Наблюдатель</option>
                    </select>
                  </div>
                  
                  {inviteError && (
                    <div className="text-sm text-orange-600 dark:text-orange-400 space-y-1">
                      <p>{inviteError}</p>
                      {inviteLink && (
                        <div className="flex items-center gap-2 bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded p-2 mt-1">
                          <input
                            readOnly
                            value={inviteLink}
                            className="flex-1 text-xs bg-transparent outline-none text-gray-700 truncate"
                            onClick={(e) => e.target.select()}
                          />
                          <button
                            type="button"
                            onClick={() => { navigator.clipboard.writeText(inviteLink); alert('Ссылка скопирована!'); }}
                            className="text-xs px-2 py-1 bg-orange-100 hover:bg-orange-200 rounded text-orange-700 whitespace-nowrap"
                          >
                            Копировать
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  
                  <button
                    type="submit"
                    disabled={isInviting}
                    className="btn-primary disabled:opacity-50"
                  >
                    <UserPlus size={16} className="mr-2" />
                    {isInviting ? 'Отправка...' : 'Отправить приглашение'}
                  </button>
                </form>
              </div>

              {/* Активные приглашения */}
              {pendingInvitations.length > 0 && (
                <div className="bg-white dark:bg-gray-800 shadow-md rounded-xl p-6">
                  <h2 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Активные приглашения ({pendingInvitations.length})</h2>

                  <div className="space-y-3">
                    {pendingInvitations.map((invitation) => (
                      <div key={invitation.id} className="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-700 rounded-xl">
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {invitation.invited_email}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            Роль: {roleLabels[invitation.role]} •
                            Отправлено: {new Date(invitation.invited_at).toLocaleDateString()}
                          </p>
                        </div>

                        <div className="flex items-center space-x-2">
                          <span className="px-2 py-1 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-400 text-xs rounded-full">
                            Ожидание
                          </span>
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
