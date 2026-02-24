import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../contexts/AuthContext';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { usePermissions } from '../hooks/usePermissions';
import useOperations from '../hooks/useOperations';
import { formatSignedAmount, parseAmount, normalizeAmountInput, formatAmountInput } from '../utils/formatters';

const OPERATION_TYPES = {
  income: { label: 'Доход',    sign: '+', color: 'text-green-600' },
  expense: { label: 'Расход',  sign: '−', color: 'text-red-600' },
  salary: { label: 'Зарплата', sign: '−', color: 'text-blue-600' }
};

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
  const [amountFocused, setAmountFocused] = useState(false);
  const [filterType, setFilterType] = useState(null); // null = все
  const [sortField, setSortField] = useState('date');   // 'date' | 'amount'
  const [sortDir, setSortDir]   = useState('desc');      // 'asc' | 'desc'

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };
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

  // Отфильтрованные и отсортированные операции для отображения
  const visibleOperations = useMemo(() => {
    const filtered = filterType
      ? monthlyOperations.filter((op) => op.type === filterType)
      : [...monthlyOperations];

    return filtered.sort((a, b) => {
      let valA, valB;
      if (sortField === 'amount') {
        valA = Math.abs(Number(a.amount) || 0);
        valB = Math.abs(Number(b.amount) || 0);
      } else {
        // date
        valA = new Date(a.operation_date || a.created_at).getTime();
        valB = new Date(b.operation_date || b.created_at).getTime();
      }
      return sortDir === 'asc' ? valA - valB : valB - valA;
    });
  }, [monthlyOperations, filterType, sortField, sortDir]);

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

    const amount = parseAmount(formData.amount);
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
        <div className="flex gap-2">
          <button
            onClick={() => openAddModal('income')}
            disabled={!permissions.canCreateOperations || loading}
            className="flex-1 min-w-0 px-2 py-2 rounded-lg bg-green-50 text-green-700 border border-green-200 disabled:opacity-50 font-medium truncate"
          >
            <span className="hidden xs:inline">+&nbsp;Доход</span>
            <span className="xs:hidden">+</span>
          </button>
          <button
            onClick={() => openAddModal('expense')}
            disabled={!permissions.canCreateOperations || loading}
            className="flex-1 min-w-0 px-2 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200 disabled:opacity-50 font-medium truncate"
          >
            <span className="hidden xs:inline">−&nbsp;Расход</span>
            <span className="xs:hidden">−</span>
          </button>
          <button
            onClick={() => openAddModal('salary')}
            disabled={!permissions.canCreateOperations || loading}
            className="flex-1 min-w-0 px-2 py-2 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 disabled:opacity-50 font-medium truncate"
          >
            <span className="hidden xs:inline">💰&nbsp;Зарплата</span>
            <span className="xs:hidden">💰</span>
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

      {/* Фильтр + Сортировка */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {/* Фильтр по типу */}
        {[
          { key: null,      label: 'Все' },
          { key: 'income',  label: '+ Доход' },
          { key: 'expense', label: '− Расход' },
          { key: 'salary',  label: '💰 Зарплата' },
        ].map(({ key, label }) => (
          <button
            key={String(key)}
            onClick={() => setFilterType(key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              filterType === key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600'
            }`}
          >
            {label}
          </button>
        ))}

        {/* Разделитель */}
        <span className="text-gray-300 select-none">|</span>

        {/* Сортировка по дате */}
        <button
          onClick={() => toggleSort('date')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors flex items-center gap-1 ${
            sortField === 'date'
              ? 'bg-gray-700 text-white border-gray-700'
              : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'
          }`}
        >
          Дата {sortField === 'date' ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
        </button>

        {/* Сортировка по сумме */}
        <button
          onClick={() => toggleSort('amount')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors flex items-center gap-1 ${
            sortField === 'amount'
              ? 'bg-gray-700 text-white border-gray-700'
              : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'
          }`}
        >
          Сумма {sortField === 'amount' ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
        </button>

        {filterType && (
          <span className="text-xs text-gray-400">
            {visibleOperations.length} из {monthlyOperations.length}
          </span>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 divide-y divide-gray-100">
        {loading && monthlyOperations.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-3">Загрузка операций...</p>
          </div>
        ) : visibleOperations.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            {filterType
              ? `Нет операций типа «${OPERATION_TYPES[filterType]?.label}» за этот месяц.`
              : 'В этом месяце операций пока нет.'}
          </div>
        ) : (
          visibleOperations.map((operation) => {
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
                    {formatSignedAmount(operation.type, operation.amount)}
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
                  Сумма, ₽
                </label>
                <input
                  id="operationAmount"
                  type="text"
                  inputMode="decimal"
                  value={amountFocused ? formData.amount : formatAmountInput(formData.amount)}
                  onFocus={() => setAmountFocused(true)}
                  onBlur={() => setAmountFocused(false)}
                  onChange={(event) => setFormData((prev) => ({
                    ...prev,
                    amount: normalizeAmountInput(event.target.value)
                  }))}
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
