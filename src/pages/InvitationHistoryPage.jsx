import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, CheckCircle, XCircle, AlertCircle, Download, Filter } from 'lucide-react';
import { supabase } from '../contexts/AuthContext';

const statusConfig = {
  pending: {
    label: 'Ожидает',
    icon: Clock,
    color: 'text-yellow-600 bg-yellow-100',
  },
  accepted: {
    label: 'Принято',
    icon: CheckCircle,
    color: 'text-green-600 bg-green-100',
  },
  declined: {
    label: 'Отклонено',
    icon: XCircle,
    color: 'text-red-600 bg-red-100',
  },
  expired: {
    label: 'Истекло',
    icon: AlertCircle,
    color: 'text-gray-600 bg-gray-100',
  },
};

export default function InvitationHistoryPage() {
  const navigate = useNavigate();
  const { workspaceId } = useParams();
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Фильтры
  const [statusFilter, setStatusFilter] = useState('all'); // all, pending, accepted, declined, expired
  const [dateSort, setDateSort] = useState('desc'); // desc, asc

  useEffect(() => {
    loadInvitations();
  }, [workspaceId, statusFilter, dateSort]);

  const loadInvitations = async () => {
    if (!workspaceId) return;

    setLoading(true);
    setError('');

    try {
      let query = supabase
        .from('workspace_invitations')
        .select(`
          *,
          workspaces(name),
          users!invited_by(email)
        `)
        .eq('workspace_id', workspaceId);

      // Фильтрация по статусу
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      // Сортировка по дате
      const column = 'invited_at';
      query = query.order(column, { ascending: dateSort === 'asc' });

      const { data, error } = await query;

      if (error) throw error;

      setInvitations(data || []);
    } catch (err) {
      console.error('Error loading invitations:', err);
      setError('Ошибка загрузки истории приглашений');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      // Подготовка данных для экспорта
      const csvData = invitations.map(inv => {
        const statusInfo = statusConfig[inv.status] || statusConfig.pending;
        return {
          'Email': inv.invited_email,
          'Роль': inv.role,
          'Статус': statusInfo.label,
          'Отправлено': new Date(inv.invited_at).toLocaleString('ru-RU'),
          'Истекает': new Date(inv.expires_at).toLocaleString('ru-RU'),
          'Принято': inv.accepted_at ? new Date(inv.accepted_at).toLocaleString('ru-RU') : '',
          'Отправок': inv.email_sent_count || 0,
          'Кем приглашено': inv.users?.email || '',
        };
      });

      // Конвертация в CSV
      const headers = Object.keys(csvData[0] || {});
      const csv = [
        headers.join(','),
        ...csvData.map(row => headers.map(header => {
          const value = row[header] || '';
          return `"${value.toString().replace(/"/g, '""')}"`;
        }).join(','))
      ].join('\n');

      // Скачивание файла
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `invitations-history-${workspaceId}-${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
    } catch (err) {
      console.error('Error exporting invitations:', err);
      alert('Ошибка при экспорте истории приглашений');
    }
  };

  const filteredInvitations = invitations;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Шапка */}
        <div className="mb-6">
          <button
            onClick={() => navigate(`/workspace/${workspaceId}/settings`)}
            className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft size={20} className="mr-2" />
            Назад к настройкам
          </button>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                История приглашений
              </h1>
              <p className="text-gray-600 mt-1">
                Все приглашения в этом рабочем пространстве
              </p>
            </div>

            <button
              onClick={handleExport}
              className="flex items-center px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              disabled={loading || filteredInvitations.length === 0}
            >
              <Download size={16} className="mr-2" />
              Экспорт
            </button>
          </div>
        </div>

        {/* Фильтры */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Filter size={18} className="text-gray-600" />
              <span className="text-sm font-medium text-gray-700">Статус:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">Все</option>
                <option value="pending">Ожидает</option>
                <option value="accepted">Принято</option>
                <option value="declined">Отклонено</option>
                <option value="expired">Истекло</option>
              </select>
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium text-gray-700">Сортировка:</span>
              <select
                value={dateSort}
                onChange={(e) => setDateSort(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="desc">Сначала новые</option>
                <option value="asc">Сначала старые</option>
              </select>
            </div>
          </div>
        </div>

        {/* Загрузка */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="text-gray-600 mt-4">Загрузка...</p>
          </div>
        )}

        {/* Ошибка */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            {error}
          </div>
        )}

        {/* Нет данных */}
        {!loading && !error && filteredInvitations.length === 0 && (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Clock size={48} className="text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Нет приглашений
            </h3>
            <p className="text-gray-600">
              {statusFilter === 'all'
                ? 'В этом рабочем пространстве пока нет приглашений'
                : 'Нет приглашений с выбранным статусом'}
            </p>
          </div>
        )}

        {/* Таблица приглашений */}
        {!loading && !error && filteredInvitations.length > 0 && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Роль
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Статус
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Отправлено
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Истекает
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Отправок
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredInvitations.map((invitation) => {
                  const statusInfo = statusConfig[invitation.status] || statusConfig.pending;
                  const StatusIcon = statusInfo.icon;

                  return (
                    <tr key={invitation.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {invitation.invited_email}
                        </div>
                        {invitation.users?.email && (
                          <div className="text-xs text-gray-500">
                            От: {invitation.users.email}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 capitalize">
                          {invitation.role}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${statusInfo.color}`}>
                          <StatusIcon size={12} className="mr-1" />
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(invitation.invited_at).toLocaleDateString('ru-RU')}
                        {' '}
                        <span className="text-xs">
                          {new Date(invitation.invited_at).toLocaleTimeString('ru-RU', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(invitation.expires_at).toLocaleDateString('ru-RU')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {invitation.email_sent_count || 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Пагинация (опционально) */}
            {filteredInvitations.length > 50 && (
              <div className="bg-gray-50 px-6 py-3 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-700">
                    Показано {filteredInvitations.length} приглашений
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
