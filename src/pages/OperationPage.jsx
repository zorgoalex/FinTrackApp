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
import { Pencil, Trash2, ChevronDown, X } from 'lucide-react';
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
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const tagDropdownRef = useRef(null);
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('operationsViewMode') || 'detailed');

  const handleViewMode = (mode) => {
    setViewMode(mode);
    localStorage.setItem('operationsViewMode', mode);
  };

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

  // Close tag dropdown on outside click
  useEffect(() => {
    if (!showTagDropdown) return;
    const handler = (e) => {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target)) {
        setShowTagDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTagDropdown]);

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

        <span className="text-gray-300 select-none">|</span>

        <button
          onClick={() => handleViewMode('detailed')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
            viewMode === 'detailed'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-400 border-gray-300 hover:border-blue-400 hover:text-blue-600'
          }`}
        >
          Подробный
        </button>
        <button
          onClick={() => handleViewMode('compact')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
            viewMode === 'compact'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-400 border-gray-300 hover:border-blue-400 hover:text-blue-600'
          }`}
        >
          Компактный
        </button>
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

      {/* Tag filter — dropdown multi-select */}
      {tags.length > 0 && (
        <div className="relative mb-3" ref={tagDropdownRef} data-testid="tag-filter">
          <button
            type="button"
            onClick={() => setShowTagDropdown((v) => !v)}
            className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors ${
              filterTags.length > 0
                ? 'bg-indigo-50 border-indigo-400 text-indigo-700'
                : 'bg-white border-gray-300 text-gray-600 hover:border-indigo-400'
            }`}
          >
            <span>Теги</span>
            {filterTags.length > 0 && (
              <span className="bg-indigo-600 text-white text-xs font-medium rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {filterTags.length}
              </span>
            )}
            <ChevronDown size={14} className={`transition-transform ${showTagDropdown ? 'rotate-180' : ''}`} />
            {filterTags.length > 0 && (
              <span
                role="button"
                tabIndex={0}
                className="ml-0.5 text-indigo-400 hover:text-indigo-700"
                onClick={(e) => { e.stopPropagation(); setFilterTags([]); }}
                onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), setFilterTags([]))}
              >
                <X size={13} />
              </span>
            )}
          </button>

          {showTagDropdown && (
            <div className="absolute z-20 top-full mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px] max-h-60 overflow-y-auto">
              {tags.map((tag) => {
                const active = filterTags.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => setFilterTags((prev) =>
                      active ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]
                    )}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-indigo-50 transition-colors"
                  >
                    <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${
                      active ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'
                    }`}>
                      {active && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
                    </span>
                    <span className={active ? 'text-indigo-700 font-medium' : 'text-gray-700'}>
                      #{tag.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
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

            if (viewMode === 'compact') {
              return (
                <div
                  key={operation.id}
                  className={`px-4 py-2 flex items-center justify-between gap-3${canEditRecord(operation) ? ' cursor-pointer' : ''}`}
                  onDoubleClick={() => canEditRecord(operation) && setEditingOperation(operation)}
                  onTouchEnd={() => handleDoubleTap(operation)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm text-gray-500 shrink-0">
                      {formatOperationDate(operation.operation_date || operation.created_at)}
                    </span>
                    <span className={`text-sm font-medium shrink-0 ${typeInfo.color}`}>
                      {typeInfo.label}
                    </span>
                    <span className="text-lg font-semibold text-gray-900 truncate">
                      {formatSignedAmount(operation.type, operation.amount)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {canEditRecord(operation) && (
                      <button
                        onClick={() => setEditingOperation(operation)}
                        disabled={loading}
                        className="text-xs px-2 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-indigo-600 hover:border-indigo-200 disabled:opacity-50"
                        title="Редактировать"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {canDeleteRecord(operation) && (
                      <button
                        onClick={() => handleDelete(operation.id)}
                        disabled={loading}
                        className="text-xs px-2 py-1.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                        title="Удалить"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            }

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
                  {operation.tags && operation.tags.length > 0 && (
                    <div className="flex flex-wrap gap-x-1.5 gap-y-0.5 mt-0.5">
                      {operation.tags.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className="text-[0.7rem] italic text-green-400 hover:text-green-600 hover:underline cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFilterTags((prev) =>
                              prev.includes(t.id) ? prev : [...prev, t.id]
                            );
                          }}
                        >
                          #{t.name}
                        </button>
                      ))}
                    </div>
                  )}
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
