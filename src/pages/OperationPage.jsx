import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../contexts/AuthContext';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { usePermissions } from '../hooks/usePermissions';
import useOperations from '../hooks/useOperations';

const OPERATION_TYPES = {
  income: { label: 'Доход', sign: '+', color: 'text-green-600' },
  expense: { label: 'Расход', sign: '-', color: 'text-red-600' },
  salary: { label: 'Зарплата', sign: '-', color: 'text-blue-600' }
};

const amountFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 0
});

function formatAmount(operationType, amount) {
  const info = OPERATION_TYPES[operationType] || OPERATION_TYPES.expense;
  return `${info.sign}${amountFormatter.format(Math.abs(Number(amount) || 0))} ₽`;
}

function formatOperationDate(value) {
  if (!value) return 'Без даты';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Без даты';
  return date.toLocaleDateString('ru-RU');
}

function isDateInCurrentMonth(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function getDefaultType(searchParams) {
  const type = (searchParams.get('type') || '').toLowerCase();
  return Object.keys(OPERATION_TYPES).includes(type) ? type : 'income';
}

export function OperationPage() {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { workspaceId: workspaceIdFromContext } = useWorkspace();
  const permissions = usePermissions();

  const workspaceId = params.workspaceId || searchParams.get('workspaceId') || workspaceIdFromContext;

  const {
    operations,
    loading,
    error,
    addOperation,
    deleteOperation
  } = useOperations(workspaceId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [authorEmails, setAuthorEmails] = useState({});
  const [formData, setFormData] = useState({
    type: getDefaultType(searchParams),
    amount: '',
    description: '',
    operationDate: new Date().toISOString().slice(0, 10)
  });

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      type: getDefaultType(searchParams)
    }));
  }, [searchParams]);

  const monthlyOperations = useMemo(() => (
    (operations || []).filter((operation) => (
      isDateInCurrentMonth(operation.operation_date || operation.created_at)
    ))
  ), [operations]);

  useEffect(() => {
    const loadEmails = async () => {
      const ids = Array.from(new Set(
        monthlyOperations
          .map((operation) => operation.user_id)
          .filter(Boolean)
      ));

      if (ids.length === 0) {
        setAuthorEmails({});
        return;
      }

      const results = await Promise.all(ids.map(async (id) => {
        const { data } = await supabase.rpc('get_user_email', { user_id: id });
        return [id, data || null];
      }));

      setAuthorEmails(Object.fromEntries(results.filter(([, email]) => Boolean(email))));
    };

    loadEmails();
  }, [monthlyOperations]);

  const closeModal = () => {
    setIsModalOpen(false);
    setFormError('');
    setFormData({
      type: getDefaultType(searchParams),
      amount: '',
      description: '',
      operationDate: new Date().toISOString().slice(0, 10)
    });
  };

  const openAddModal = (type) => {
    if (!permissions.canCreateOperations) {
      return;
    }

    setFormError('');
    setFormData((prev) => ({ ...prev, type }));
    setIsModalOpen(true);
  };

  const canDeleteRecord = (operation) => {
    if (!operation) return false;
    if (permissions.isOwner || permissions.isAdmin || permissions.canDeleteOperations) return true;
    return permissions.canEditOwnOperations && operation.user_id === user?.id;
  };

  const handleDelete = async (operationId) => {
    if (!operationId) return;

    const confirmed = window.confirm('Удалить операцию?');
    if (!confirmed) return;

    await deleteOperation(operationId);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const amount = Number(formData.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('Сумма должна быть больше нуля');
      return;
    }

    const created = await addOperation({
      type: formData.type,
      amount,
      description: formData.description,
      operation_date: formData.operationDate
    });

    if (!created) {
      return;
    }

    closeModal();
  };

  const getAuthorText = (operation) => {
    if (!operation?.user_id) {
      return 'Удалённый пользователь';
    }

    return authorEmails[operation.user_id]
      || (operation.user_id === user?.id ? user?.email : null)
      || operation.displayName
      || 'Пользователь';
  };

  const goBack = () => {
    if (workspaceId) {
      navigate(`/workspace/${workspaceId}`);
      return;
    }
    navigate('/workspaces');
  };

  if (!workspaceId) {
    return (
      <div className="max-w-3xl mx-auto p-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
          <p className="text-gray-700">Выберите рабочее пространство, чтобы смотреть операции.</p>
          <button onClick={() => navigate('/workspaces')} className="btn-primary mt-4">
            К списку пространств
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 pb-24">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Операции за текущий месяц</h1>
        <button onClick={goBack} className="btn-secondary">
          Назад
        </button>
      </header>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            onClick={() => openAddModal('income')}
            disabled={!permissions.canCreateOperations || loading}
            className="px-4 py-2 rounded-lg bg-green-50 text-green-700 border border-green-200 disabled:opacity-50"
          >
            +Доход
          </button>
          <button
            onClick={() => openAddModal('expense')}
            disabled={!permissions.canCreateOperations || loading}
            className="px-4 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200 disabled:opacity-50"
          >
            -Расход
          </button>
          <button
            onClick={() => openAddModal('salary')}
            disabled={!permissions.canCreateOperations || loading}
            className="px-4 py-2 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 disabled:opacity-50"
          >
            Зарплата
          </button>
        </div>
        {!permissions.canCreateOperations && (
          <p className="text-xs text-gray-500 mt-2">У вас нет прав на добавление операций.</p>
        )}
      </div>

      {(error || formError) && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">
          {formError || error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 divide-y divide-gray-100">
        {loading && monthlyOperations.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-3">Загрузка операций...</p>
          </div>
        ) : monthlyOperations.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            В этом месяце операций пока нет.
          </div>
        ) : (
          monthlyOperations.map((operation) => {
            const typeInfo = OPERATION_TYPES[operation.type] || OPERATION_TYPES.expense;

            return (
              <div key={operation.id} className="p-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm text-gray-500 mb-1">
                    {formatOperationDate(operation.operation_date || operation.created_at)}
                  </div>
                  <div className={`text-sm font-medium ${typeInfo.color}`}>
                    {typeInfo.label}
                  </div>
                  <div className="text-lg font-semibold text-gray-900">
                    {formatAmount(operation.type, operation.amount)}
                  </div>
                  <div className="text-sm text-gray-700 mt-1 break-words">
                    {operation.description || 'Без описания'}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {getAuthorText(operation)}
                  </div>
                </div>

                {canDeleteRecord(operation) && (
                  <button
                    onClick={() => handleDelete(operation.id)}
                    disabled={loading}
                    className="text-xs px-3 py-1.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Удалить
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-xl border border-gray-200 w-full max-w-md p-4">
            <h2 className="text-lg font-semibold mb-4">Новая операция</h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="operationType" className="block text-sm font-medium text-gray-700 mb-1">
                  Тип
                </label>
                <select
                  id="operationType"
                  value={formData.type}
                  onChange={(event) => setFormData((prev) => ({ ...prev, type: event.target.value }))}
                  className="input-field"
                >
                  <option value="income">Доход</option>
                  <option value="expense">Расход</option>
                  <option value="salary">Зарплата</option>
                </select>
              </div>

              <div>
                <label htmlFor="operationAmount" className="block text-sm font-medium text-gray-700 mb-1">
                  Сумма
                </label>
                <input
                  id="operationAmount"
                  type="number"
                  min="0"
                  step="1"
                  value={formData.amount}
                  onChange={(event) => setFormData((prev) => ({ ...prev, amount: event.target.value }))}
                  className="input-field"
                  placeholder="0"
                  required
                />
              </div>

              <div>
                <label htmlFor="operationDescription" className="block text-sm font-medium text-gray-700 mb-1">
                  Описание
                </label>
                <textarea
                  id="operationDescription"
                  value={formData.description}
                  onChange={(event) => setFormData((prev) => ({ ...prev, description: event.target.value }))}
                  className="input-field"
                  rows="3"
                  placeholder="Комментарий к операции"
                />
              </div>

              <div>
                <label htmlFor="operationDate" className="block text-sm font-medium text-gray-700 mb-1">
                  Дата
                </label>
                <input
                  id="operationDate"
                  type="date"
                  value={formData.operationDate}
                  onChange={(event) => setFormData((prev) => ({ ...prev, operationDate: event.target.value }))}
                  className="input-field"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={closeModal} className="btn-secondary" disabled={loading}>
                  Отмена
                </button>
                <button type="submit" className="btn-primary" disabled={loading}>
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
