import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../contexts/AuthContext';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { usePermissions } from '../hooks/usePermissions';
import useOperations from '../hooks/useOperations';
import useCategories from '../hooks/useCategories';
import useTags from '../hooks/useTags';
import AddOperationModal from '../components/AddOperationModal';
import EditOperationModal from '../components/EditOperationModal';
import { Pencil } from 'lucide-react';
import { formatSignedAmount } from '../utils/formatters';

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
    updateOperation,
    deleteOperation
  } = useOperations(workspaceId);

  const { categories } = useCategories(workspaceId);
  const { tags } = useTags(workspaceId);


  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState('income');
  const [editingOperation, setEditingOperation] = useState(null);
  const [authorEmails, setAuthorEmails] = useState({});
  const [filterType, setFilterType] = useState(null);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterTags, setFilterTags] = useState([]);
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const monthlyOperations = useMemo(() => (
    (operations || []).filter((operation) => (
      isDateInCurrentMonth(operation.operation_date || operation.created_at)
    ))
  ), [operations]);

  const visibleOperations = useMemo(() => {
    let filtered = filterType
      ? monthlyOperations.filter((op) => op.type === filterType)
      : [...monthlyOperations];

    if (filterCategory)
      filtered = filtered.filter((op) => op.category_id === filterCategory);

    if (filterTags.length > 0)
      filtered = filtered.filter((op) =>
        filterTags.some((tagId) => op.tags?.some((t) => t.id === tagId))
      );

    return filtered.sort((a, b) => {
      let valA, valB;
      if (sortField === 'amount') {
        valA = Math.abs(Number(a.amount) || 0);
        valB = Math.abs(Number(b.amount) || 0);
      } else {
        valA = new Date(a.operation_date || a.created_at).getTime();
        valB = new Date(b.operation_date || b.created_at).getTime();
      }
      return sortDir === 'asc' ? valA - valB : valB - valA;
    });
  }, [monthlyOperations, filterType, filterCategory, filterTags, sortField, sortDir]);

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
  };

  const openAddModal = (type) => {
    if (!permissions.canCreateOperations) return;
    setModalType(type);
    setIsModalOpen(true);
  };

  const handleModalSave = async (payload) => {
    const result = await addOperation(payload);
    if (result) closeModal();
  };

  const canEditRecord = (operation) => {
    if (!operation) return false;
    if (permissions.isOwner || permissions.isAdmin || permissions.canEditAllOperations) return true;
    return permissions.canEditOwnOperations && operation.user_id === user?.id;
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

  const handleEditSave = async (operationId, data) => {
    const result = await updateOperation(operationId, data);
    if (!result) throw new Error('Ошибка обновления операции');
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

  // Double-tap support for mobile (onDoubleClick doesn't work on touch devices)
  const lastTapRef = useRef(0);
  const handleDoubleTap = useCallback((operation) => {
    if (!canEditRecord(operation)) return;
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0;
      setEditingOperation(operation);
    } else {
      lastTapRef.current = now;
    }
  }, [permissions, user]);

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

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {/* Фильтр + Сортировка */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {[
          { key: null,      label: 'Все' },
          { key: 'income',  label: '+ Доход' },
          { key: 'expense', label: '− Расход' },
          { key: 'salary',  label: '💰 Зарплата' },
        ].map(({ key, label }) => (
          <button
            key={String(key)}
            onClick={() => setFilterType(key)}
            data-testid={`type-filter-${key ?? 'all'}`}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              filterType === key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600'
            }`}
          >
            {label}
          </button>
        ))}

        <span className="text-gray-300 select-none">|</span>

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

      {/* Category filter — show always so user knows it exists */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-gray-500 shrink-0">Категория:</span>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-2 py-1 flex-1 max-w-[200px]"
          data-testid="category-filter"
        >
          <option value="">Все категории</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.type === 'income' ? 'доход' : 'расход'})
            </option>
          ))}
        </select>
      </div>

      {/* Tag filter */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3" data-testid="tag-filter">
          {tags.map((tag) => {
            const active = filterTags.includes(tag.id);
            return (
              <button
                key={tag.id}
                onClick={() => setFilterTags((prev) =>
                  active ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]
                )}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  active
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
                }`}
              >
                #{tag.name} {active && '×'}
              </button>
            );
          })}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 divide-y divide-gray-100">
        {loading && monthlyOperations.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-3">Загрузка операций...</p>
          </div>
        ) : visibleOperations.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            {filterType || filterCategory || filterTags.length > 0
              ? 'Нет операций, соответствующих фильтру.'
              : 'В этом месяце операций пока нет.'}
          </div>
        ) : (
          visibleOperations.map((operation) => {
            const typeInfo = OPERATION_TYPES[operation.type] || OPERATION_TYPES.expense;

            return (
              <div
                key={operation.id}
                className={`p-4 flex items-start justify-between gap-4${canEditRecord(operation) ? ' cursor-pointer' : ''}`}
                onDoubleClick={() => canEditRecord(operation) && setEditingOperation(operation)}
                onTouchEnd={() => handleDoubleTap(operation)}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm text-gray-500">
                      {formatOperationDate(operation.operation_date || operation.created_at)}
                    </span>
                    <span className={`text-sm font-medium ${typeInfo.color}`}>
                      {typeInfo.label}
                    </span>
                  </div>
                  <div className="text-lg font-semibold text-gray-900">
                    {formatSignedAmount(operation.type, operation.amount)}
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 items-center text-sm text-gray-500">
                    {(() => {
                      const parts = [];
                      if (operation.description) {
                        parts.push(
                          <span key="desc" className="text-purple-600">
                            {operation.description}
                          </span>
                        );
                      }
                      const catName = operation.category_id && categories.length > 0
                        ? categories.find((c) => c.id === operation.category_id)?.name
                        : null;
                      if (catName) {
                        parts.push(<span key="cat" className="text-orange-500 font-medium">{catName}</span>);
                      }
                      if (operation.tags && operation.tags.length > 0) {
                        parts.push(
                          <span key="tags" className="text-green-600 italic">
                            {operation.tags.map((t, idx) => (
                              <span key={t.id}>
                                {idx > 0 && ' '}
                                <button
                                  type="button"
                                  className="hover:underline cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setFilterTags((prev) =>
                                      prev.includes(t.id) ? prev : [...prev, t.id]
                                    );
                                  }}
                                >
                                  #{t.name}
                                </button>
                              </span>
                            ))}
                          </span>
                        );
                      }
                      parts.push(
                        <span key="author" className="text-gray-400 text-xs">{getAuthorText(operation)}</span>
                      );
                      return parts.reduce((acc, part, i) => {
                        if (i > 0) acc.push(<span key={`sep-${i}`} className="text-gray-300">·</span>);
                        acc.push(part);
                        return acc;
                      }, []);
                    })()}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 shrink-0">
                  {canEditRecord(operation) && (
                    <button
                      onClick={() => setEditingOperation(operation)}
                      disabled={loading}
                      className="text-xs px-2.5 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-indigo-600 hover:border-indigo-200 disabled:opacity-50"
                      title="Редактировать"
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                  {canDeleteRecord(operation) && (
                    <button
                      onClick={() => handleDelete(operation.id)}
                      disabled={loading}
                      className="text-xs px-2.5 py-1.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Удалить
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {isModalOpen && (
        <AddOperationModal
          type={modalType}
          workspaceId={workspaceId}
          onClose={closeModal}
          onSave={handleModalSave}
        />
      )}

      {editingOperation && (
        <EditOperationModal
          operation={editingOperation}
          workspaceId={workspaceId}
          onClose={() => setEditingOperation(null)}
          onSave={handleEditSave}
        />
      )}
    </div>
  );
}
