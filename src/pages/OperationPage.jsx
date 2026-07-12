import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../contexts/AuthContext';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { usePermissions } from '../hooks/usePermissions';
import useOperations from '../hooks/useOperations';
import useCategories from '../hooks/useCategories';
import useTags from '../hooks/useTags';
import useAccounts from '../hooks/useAccounts';
import AddOperationModal from '../components/AddOperationModal';
import EditOperationModal from '../components/EditOperationModal';
import QuickButtonsSettings from '../components/QuickButtonsSettings';
import MonthPicker from '../components/MonthPicker';
import { Pencil, Trash2, ChevronDown, X, Plus, Settings, Wallet, Download, Upload, Search, SlidersHorizontal, MoreHorizontal } from 'lucide-react';
import { formatSignedAmount, formatUnsignedAmount, formatGroupDate } from '../utils/formatters';
import { getMonthRange } from '../utils/dateRange';
import { buildOperationsCSV, downloadOperationsCSV } from '../utils/export';

const ImportOperationsModal = lazy(() => import('../components/ImportOperationsModal'));

const OPERATION_TYPES = {
  income:   { label: 'Доход',    sign: '+', color: 'text-green-600' },
  expense:  { label: 'Расход',   sign: '−', color: 'text-red-600' },
  personal_salary: { label: 'Личная зарплата', sign: '+', color: 'text-green-600' },
  employee_salary: { label: 'Зарплата сотрудникам', sign: '−', color: 'text-blue-600' },
  transfer: { label: 'Перевод',  sign: '⇄', color: 'text-purple-600' },
};

function formatOperationDate(value) {
  if (!value) return 'Без даты';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Без даты';
  return date.toLocaleDateString('ru-RU');
}

export function OperationPage() {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { workspaceId: workspaceIdFromContext, currentWorkspace, updateQuickButtons, currencySymbol } = useWorkspace();
  const permissions = usePermissions();

  const workspaceId = params.workspaceId || searchParams.get('workspaceId') || workspaceIdFromContext;

  // Month selection state
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const { dateFrom, dateTo } = useMemo(
    () => getMonthRange(selectedMonth.year, selectedMonth.month),
    [selectedMonth.year, selectedMonth.month]
  );

  const {
    operations,
    loading,
    error,
    addOperation,
    updateOperation,
    deleteOperation,
    totalCount,
    hasMore,
    loadMore,
    loadingMore,
    refresh,
  } = useOperations(workspaceId, { dateFrom, dateTo });

  const { categories } = useCategories(workspaceId);
  const { tags } = useTags(workspaceId);
  const { accounts } = useAccounts(workspaceId);

  const categoryMap = useMemo(() => {
    const map = new Map();
    categories.forEach(c => map.set(c.id, c));
    return map;
  }, [categories]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState('income');
  const [modalCategory, setModalCategory] = useState('');
  const [showQuickSettings, setShowQuickSettings] = useState(false);
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
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [actionMenuId, setActionMenuId] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (!actionMenuId) return undefined;
    const closeMenu = () => setActionMenuId(null);
    document.addEventListener('click', closeMenu);
    return () => document.removeEventListener('click', closeMenu);
  }, [actionMenuId]);

  useEffect(() => {
    const requestedType = searchParams.get('new');
    if (!requestedType || !permissions.canCreateOperations) return;
    if (!['income', 'expense', 'transfer'].includes(requestedType)) return;
    setModalType(requestedType);
    setModalCategory('');
    setIsModalOpen(true);
    const nextParams = new globalThis.URLSearchParams(searchParams);
    nextParams.delete('new');
    setSearchParams(nextParams, { replace: true });
  }, [permissions.canCreateOperations, searchParams, setSearchParams]);

  // Visible accounts filter (null = all visible)
  const [visibleAccountIds, setVisibleAccountIds] = useState(() => {
    if (!workspaceId) return null;
    const stored = localStorage.getItem(`visibleAccounts_${workspaceId}`);
    if (!stored) return null;
    try { return JSON.parse(stored); } catch { return null; }
  });

  useEffect(() => {
    if (!workspaceId) { setVisibleAccountIds(null); return; }
    const stored = localStorage.getItem(`visibleAccounts_${workspaceId}`);
    if (!stored) { setVisibleAccountIds(null); return; }
    try { setVisibleAccountIds(JSON.parse(stored)); } catch { setVisibleAccountIds(null); }
  }, [workspaceId]);

  const activeAccounts = useMemo(() => accounts.filter(a => !a.is_archived), [accounts]);

  const toggleAccountVisibility = useCallback((accountId) => {
    setVisibleAccountIds(prev => {
      const allIds = activeAccounts.map(a => a.id);
      const current = prev || allIds;
      let next;
      if (current.includes(accountId)) {
        next = current.filter(id => id !== accountId);
        if (next.length === 0) return prev;
      } else {
        next = [...current, accountId];
      }
      if (next.length >= allIds.length) {
        localStorage.removeItem(`visibleAccounts_${workspaceId}`);
        return null;
      }
      localStorage.setItem(`visibleAccounts_${workspaceId}`, JSON.stringify(next));
      return next;
    });
  }, [activeAccounts, workspaceId]);

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

  // Build account map for display
  const accountMap = useMemo(() => {
    const map = new Map();
    accounts.forEach(a => map.set(a.id, a));
    return map;
  }, [accounts]);

  const visibleOperations = useMemo(() => {
    // Filter out 'in' direction transfers (keep 'out' only to avoid duplicates)
    let base = (operations || []).filter(op => !(op.type === 'transfer' && op.transfer_direction === 'in'));

    // Enrich transfer 'out' operations with linked account info
    const inOps = (operations || []).filter(op => op.type === 'transfer' && op.transfer_direction === 'in');
    const inByGroup = new Map();
    inOps.forEach(op => { if (op.transfer_group_id) inByGroup.set(op.transfer_group_id, op); });

    base = base.map(op => {
      if (op.type === 'transfer' && op.transfer_group_id) {
        const linked = inByGroup.get(op.transfer_group_id);
        return {
          ...op,
          _linkedAccountId: linked?.account_id || null,
          _linkedAmount: linked?.amount ?? null,
          _linkedCurrency: linked?.currency || null,
          _linkedExchangeRate: linked?.exchange_rate ?? null,
        };
      }
      return op;
    });

    let filtered = filterType
      ? base.filter((op) => filterType === 'income'
        ? ['income', 'personal_salary'].includes(op.type)
        : filterType === 'expense'
          ? ['expense', 'employee_salary'].includes(op.type)
          : op.type === filterType)
      : [...base];

    if (filterCategory)
      filtered = filtered.filter((op) => op.category_id === filterCategory);

    if (filterTags.length > 0)
      filtered = filtered.filter((op) =>
        filterTags.some((tagId) => op.tags?.some((t) => t.id === tagId))
      );

    const normalizedSearch = searchQuery.trim().toLocaleLowerCase('ru-RU');
    if (normalizedSearch) {
      filtered = filtered.filter((operation) => {
        const categoryName = operation.category_id
          ? categoryMap.get(operation.category_id)?.name
          : '';
        const accountName = accountMap.get(operation.account_id)?.name || '';
        const tagNames = (operation.tags || []).map((tag) => tag.name).join(' ');
        return [operation.description, categoryName, accountName, tagNames]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase('ru-RU').includes(normalizedSearch));
      });
    }

    // Filter by visible accounts
    if (visibleAccountIds) {
      filtered = filtered.filter((op) => visibleAccountIds.includes(op.account_id));
    }

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
  }, [operations, filterType, filterCategory, filterTags, sortField, sortDir, visibleAccountIds, searchQuery, categoryMap, accountMap]);

  const groupedOperations = useMemo(() => {
    const groups = new Map();
    visibleOperations.forEach(op => {
      const dateKey = op.operation_date || 'no-date';
      if (!groups.has(dateKey)) {
        groups.set(dateKey, []);
      }
      groups.get(dateKey).push(op);
    });
    return Array.from(groups.entries()).map(([dateKey, ops]) => ({
      dateKey,
      label: formatGroupDate(dateKey === 'no-date' ? null : dateKey),
      operations: ops,
      dayIncome: ops
        .filter(o => o.type === 'income' || o.type === 'personal_salary')
        .reduce((s, o) => s + Number(o.base_amount ?? o.amount ?? 0), 0),
      dayExpense: ops
        .filter(o => o.type === 'expense' || o.type === 'employee_salary')
        .reduce((s, o) => s + Number(o.base_amount ?? o.amount ?? 0), 0),
    }));
  }, [visibleOperations]);

  useEffect(() => {
    const loadEmails = async () => {
      const ids = Array.from(new Set(
        (operations || [])
          .map((operation) => operation.user_id)
          .filter(Boolean)
      ));

      if (ids.length === 0) {
        setAuthorEmails({});
        return;
      }

      const { data: profiles, error: profilesError } = await supabase.rpc(
        'get_workspace_member_profiles',
        { p_workspace_id: workspaceId }
      );
      if (profilesError) {
        setAuthorEmails({});
        return;
      }

      const relevantIds = new Set(ids);
      setAuthorEmails(Object.fromEntries(
        (profiles || [])
          .filter(profile => relevantIds.has(profile.user_id) && profile.email)
          .map(profile => [profile.user_id, profile.email])
      ));
    };

    loadEmails();
  }, [operations, workspaceId]);

  const closeModal = () => {
    setIsModalOpen(false);
  };

  const openAddModal = (type, category) => {
    if (!permissions.canCreateOperations) return;
    setModalType(type);
    setModalCategory(category || '');
    setIsModalOpen(true);
  };

  const quickButtons = currentWorkspace?.quick_buttons || [];

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

  const handleDelete = async (operation) => {
    const id = typeof operation === 'string' ? operation : operation?.id;
    if (!id) return;

    const isTransfer = typeof operation === 'object' && operation?.type === 'transfer';
    const confirmed = window.confirm(isTransfer ? 'Удалить перевод (обе операции)?' : 'Удалить операцию?');
    if (!confirmed) return;

    await deleteOperation(id, isTransfer ? operation.transfer_group_id : null);
  };

  const handleEditSave = async (operationId, data) => {
    const result = await updateOperation(operationId, data);
    if (!result) throw new Error('Ошибка обновления операции');
  };

  const getAuthorText = (operation) => {
    if (!operation?.user_id) {
      return 'Удалённый пользователь';
    }

    return (operation.user_id === user?.id ? 'Вы' : null)
      || authorEmails[operation.user_id]
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

  const handleExportOperations = async () => {
    const pageSize = 1000;
    const exportedOperations = [];
    setExporting(true);
    setExportError('');

    try {
      for (let from = 0; ; from += pageSize) {
        const { data, error: operationsError } = await supabase
          .from('operations')
          .select('id, amount, type, description, operation_date, category_id, account_id, transfer_direction, currency, exchange_rate, base_amount')
          .eq('workspace_id', workspaceId)
          .gte('operation_date', dateFrom)
          .lte('operation_date', dateTo)
          .order('operation_date', { ascending: true })
          .order('created_at', { ascending: true })
          .range(from, from + pageSize - 1);

        if (operationsError) throw operationsError;
        exportedOperations.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }

      const operationIds = exportedOperations.map((operation) => operation.id);
      const tagsByOperation = new Map();
      for (let index = 0; index < operationIds.length; index += 500) {
        const ids = operationIds.slice(index, index + 500);
        const { data: links, error: linksError } = await supabase
          .from('operation_tags')
          .select('operation_id, tag_id')
          .in('operation_id', ids);
        if (linksError) throw linksError;
        (links || []).forEach((link) => {
          const current = tagsByOperation.get(link.operation_id) || [];
          const tag = tags.find((item) => item.id === link.tag_id);
          if (tag) current.push(tag);
          tagsByOperation.set(link.operation_id, current);
        });
      }

      const rows = exportedOperations.map((operation) => ({
        ...operation,
        tags: tagsByOperation.get(operation.id) || []
      }));
      const csv = buildOperationsCSV(rows, {
        categories,
        accounts,
        baseCurrency: currentWorkspace?.base_currency || 'KZT'
      });
      downloadOperationsCSV(csv, dateFrom, dateTo);
    } catch (exportException) {
      console.error('OperationPage: export error', exportException);
      setExportError(exportException.message || 'Не удалось экспортировать операции');
    } finally {
      setExporting(false);
    }
  };

  if (!workspaceId) {
    return (
      <div className="max-w-2xl mx-auto p-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 text-center">
          <p className="text-gray-700 dark:text-gray-300">Выберите рабочее пространство, чтобы смотреть операции.</p>
          <button onClick={() => navigate('/workspaces')} className="btn-primary mt-4">
            К списку пространств
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 pb-24">
      <header className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <MonthPicker
          year={selectedMonth.year}
          month={selectedMonth.month}
          onChange={setSelectedMonth}
        />
        <div className="flex gap-2">
          {permissions.canCreateOperations && (
            <button onClick={() => setImportOpen(true)} className="btn-secondary min-h-11 min-w-11" disabled={loading} aria-label="Импорт выписки, чека, скриншота или CSV">
              <Upload size={16} className="mr-2" />
              <span className="hidden sm:inline">Импорт</span>
            </button>
          )}
          <button onClick={handleExportOperations} className="btn-secondary min-h-11 min-w-11" disabled={exporting || loading} aria-label={exporting ? 'Экспорт операций выполняется' : 'Экспорт операций в CSV'}>
            <Download size={16} className="mr-2" />
            <span className="hidden sm:inline">{exporting ? 'Экспорт...' : 'CSV'}</span>
          </button>
        </div>
      </header>

      {importOpen && <Suspense fallback={<div className="fixed inset-0 z-50 grid place-items-center bg-black/50 text-white">Загрузка безопасного импорта…</div>}>
        <ImportOperationsModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          workspaceId={workspaceId}
          categories={categories}
          workspaceType={currentWorkspace?.workspace_type}
          accounts={accounts}
          baseCurrency={currentWorkspace?.base_currency || 'KZT'}
          onImport={addOperation}
          onRefresh={refresh}
        />
      </Suspense>}

      {exportError && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl p-3 text-sm text-red-700 dark:text-red-400 mb-4">
          {exportError}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => openAddModal('income')}
            disabled={!permissions.canCreateOperations || loading}
            className="min-h-11 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 disabled:opacity-50 font-medium text-sm truncate btn-press"
          >
            ＋ Доход
          </button>
          <button
            onClick={() => openAddModal('expense')}
            disabled={!permissions.canCreateOperations || loading}
            className="min-h-11 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 disabled:opacity-50 font-medium text-sm truncate btn-press"
          >
            ＋ Расход
          </button>
          {accounts.filter(a => !a.is_archived).length > 1 && (
            <button
              onClick={() => openAddModal('transfer')}
              disabled={!permissions.canCreateOperations || loading}
              className="min-h-11 px-3 py-2 rounded-lg bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800 disabled:opacity-50 font-medium text-sm truncate btn-press"
            >
              ⇄ Перевод
            </button>
          )}
          {/* Custom quick buttons */}
          {quickButtons.map((btn, i) => (
            <button
              key={i}
              onClick={() => openAddModal(btn.type, btn.category)}
              disabled={!permissions.canCreateOperations || loading}
              className="min-h-11 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 disabled:opacity-50 font-medium text-sm truncate hover:bg-gray-100"
            >
              ＋ {btn.label}
            </button>
          ))}

          {/* Add custom button (owner/admin only, max 5 custom buttons) */}
          {permissions.hasManagementRights && quickButtons.length < 5 && (
            <button
              onClick={() => setShowQuickSettings(true)}
              aria-label="Настроить быстрые кнопки"
              className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              <Plus size={16} />
            </button>
          )}
        </div>
        {!permissions.canCreateOperations && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">У вас нет прав на добавление операций.</p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl p-3 text-sm text-red-700 dark:text-red-400 mb-4">
          {error}
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <span className="sr-only">Поиск операций</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Поиск операций"
            className="input-field min-h-11 pl-9"
          />
        </label>
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium md:hidden ${
            filtersOpen || filterType || filterCategory || filterTags.length > 0 || visibleAccountIds
              ? 'border-primary-400 bg-primary-50 text-primary-700'
              : 'border-gray-300 bg-white text-gray-600'
          }`}
          aria-expanded={filtersOpen}
          aria-controls="operation-filters"
        >
          <SlidersHorizontal size={16} />
          Фильтры
        </button>
      </div>

      <div id="operation-filters" className={`${filtersOpen ? 'block' : 'hidden'} mb-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800 md:block md:border-0 md:bg-transparent md:p-0 dark:md:bg-transparent`}>
      {/* Фильтр + Сортировка */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {[
          { key: null,       label: 'Все', title: 'Все типы' },
          { key: 'income',   label: '+ Доходы', title: 'Доходы' },
          { key: 'expense',  label: '− Расходы', title: 'Расходы' },
          { key: 'transfer', label: '⇄ Переводы', title: 'Переводы' },
        ].map(({ key, label, title }) => (
          <button
            key={String(key)}
            onClick={() => setFilterType(key)}
            title={title}
            aria-pressed={filterType === key}
            data-testid={`type-filter-${key ?? 'all'}`}
            className={`min-h-11 px-3 py-2 rounded-full text-sm font-semibold border transition-colors ${
              filterType === key
                ? 'bg-primary-600 dark:bg-primary-500 text-white border-primary-600 dark:border-primary-500'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400'
            }`}
          >
            {label}
          </button>
        ))}

        <span className="hidden text-gray-300 dark:text-gray-600 select-none sm:inline" aria-hidden="true">|</span>

        <button
          onClick={() => toggleSort('date')}
          aria-label={`Сортировать по дате, сейчас ${sortField === 'date' ? (sortDir === 'desc' ? 'сначала новые' : 'сначала старые') : 'не выбрано'}`}
          className={`min-h-11 px-3 py-2 rounded-full text-sm font-medium border transition-colors flex items-center gap-1 ${
            sortField === 'date'
              ? 'bg-gray-700 dark:bg-gray-600 text-white border-gray-700 dark:border-gray-600'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-gray-500'
          }`}
        >
          Дата {sortField === 'date' ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
        </button>

        <button
          onClick={() => toggleSort('amount')}
          aria-label={`Сортировать по сумме, сейчас ${sortField === 'amount' ? (sortDir === 'desc' ? 'по убыванию' : 'по возрастанию') : 'не выбрано'}`}
          className={`min-h-11 px-3 py-2 rounded-full text-sm font-medium border transition-colors flex items-center gap-1 ${
            sortField === 'amount'
              ? 'bg-gray-700 dark:bg-gray-600 text-white border-gray-700 dark:border-gray-600'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-gray-500'
          }`}
        >
          Сумма {sortField === 'amount' ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
        </button>

        {filterType && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {visibleOperations.length} из {operations.length}
          </span>
        )}

      </div>

      {/* Category filter — show always so user knows it exists */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Категория:</span>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 flex-1 max-w-[200px] bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          data-testid="category-filter"
        >
          <option value="">Все категории</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.type === 'income' ? 'доход' : 'расход'}){c.is_archived ? ' (архив)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Account filter */}
      {activeAccounts.length > 0 && (
        <div className="flex items-center gap-2 mb-2">
          <div className="flex items-center gap-1.5">
            <Wallet size={14} className="text-gray-500 dark:text-gray-400" />
            <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Счета:</span>
            {visibleAccountIds && (
              <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                [{visibleAccountIds.length}/{activeAccounts.length}]
              </span>
            )}
            <button
              onClick={() => setAccountSettingsOpen(v => !v)}
              aria-label="Настроить отображение счетов"
              className={`grid min-h-11 min-w-11 place-items-center rounded-lg transition-colors ${
                accountSettingsOpen
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
              }`}
              title="Настройка отображения счетов"
            >
              <Settings size={14} />
            </button>
          </div>
        </div>
      )}

      {accountSettingsOpen && activeAccounts.length > 0 && (
        <div className="mb-3 p-2 bg-gray-50 dark:bg-gray-750 rounded-lg border border-gray-200 dark:border-gray-700 space-y-1">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Отображать операции по счетам:</p>
          {activeAccounts.map(acc => {
            const isVisible = !visibleAccountIds || visibleAccountIds.includes(acc.id);
            return (
              <label key={acc.id} className="flex items-center gap-2 cursor-pointer py-0.5">
                <input
                  type="checkbox"
                  checked={isVisible}
                  onChange={() => toggleAccountVisibility(acc.id)}
                  className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                />
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: acc.color || '#6B7280' }} />
                <span className="text-sm text-gray-700 dark:text-gray-300">{acc.name}</span>
              </label>
            );
          })}
        </div>
      )}

      {/* Tag filter + View mode toggle row */}
      <div className="flex items-start justify-between mb-3">
        {/* Tag filter — dropdown multi-select */}
        {tags.length > 0 ? (
          <div className="relative" ref={tagDropdownRef} data-testid="tag-filter">
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
              <div className="absolute z-20 top-full mt-1 left-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 min-w-[160px] max-h-60 overflow-y-auto">
                {tags.map((tag) => {
                  const active = filterTags.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => setFilterTags((prev) =>
                        active ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]
                      )}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
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
        ) : <div />}

        {/* View mode toggle — compact radio buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => handleViewMode('detailed')}
            className={`min-h-11 px-3 py-2 rounded-lg text-xs transition-colors ${
              viewMode === 'detailed'
                ? 'bg-primary-600 dark:bg-primary-500 text-white'
                : 'text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-300'
            }`}
          >
            Подробный
          </button>
          <button
            onClick={() => handleViewMode('compact')}
            className={`min-h-11 px-3 py-2 rounded-lg text-xs transition-colors ${
              viewMode === 'compact'
                ? 'bg-primary-600 dark:bg-primary-500 text-white'
                : 'text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-300'
            }`}
          >
            Компактный
          </button>
        </div>
      </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
        {loading && operations.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 dark:border-primary-400 mx-auto"></div>
            <p className="mt-3">Загрузка операций...</p>
          </div>
        ) : visibleOperations.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            {filterType || filterCategory || filterTags.length > 0
              ? 'Нет операций, соответствующих фильтру.'
              : 'В этом месяце операций нет.'}
          </div>
        ) : (
          groupedOperations.map(group => (
            <div key={group.dateKey}>
              {/* Date header */}
              <div className="sticky top-0 bg-gray-50 dark:bg-gray-900 px-4 py-2 flex items-center justify-between border-b border-gray-200 dark:border-gray-700" data-testid="date-group-header">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{group.label}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {group.dayIncome > 0 && <span className="text-green-600">+{formatUnsignedAmount(group.dayIncome, currencySymbol)}</span>}
                  {group.dayIncome > 0 && group.dayExpense > 0 && ' / '}
                  {group.dayExpense > 0 && <span className="text-red-600">−{formatUnsignedAmount(group.dayExpense, currencySymbol)}</span>}
                </span>
              </div>
              {/* Operations in this group */}
              {group.operations.map(operation => {
                const typeInfo = OPERATION_TYPES[operation.type] || OPERATION_TYPES.expense;

                const typeColor = operation.type === 'transfer' ? 'text-gray-600 dark:text-gray-400' : typeInfo.color;

                if (viewMode === 'compact') {
                  return (
                    <div
                      key={operation.id}
                      className={`px-4 py-2 flex items-center justify-between gap-3${canEditRecord(operation) ? ' cursor-pointer' : ''}`}
                      onDoubleClick={() => canEditRecord(operation) && setEditingOperation(operation)}
                      onTouchEnd={() => handleDoubleTap(operation)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-sm text-gray-500 dark:text-gray-400 shrink-0">
                          {formatOperationDate(operation.operation_date || operation.created_at)}
                        </span>
                        <span className={`text-sm font-medium shrink-0 ${typeColor}`}>
                          {typeInfo.label}
                        </span>
                        <span className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100 truncate">
                          {formatSignedAmount(operation.type, operation.amount, operation.currency || currencySymbol)}
                        </span>
                      </div>
                      {(canEditRecord(operation) || canDeleteRecord(operation)) && (
                        <div className="relative shrink-0" onTouchEnd={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); setActionMenuId(id => id === operation.id ? null : operation.id); }}
                            className="grid min-h-11 min-w-11 place-items-center rounded-xl text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                            aria-label="Действия с операцией"
                            aria-expanded={actionMenuId === operation.id}
                          ><MoreHorizontal size={20} /></button>
                          {actionMenuId === operation.id && (
                            <div className="absolute right-0 top-12 z-20 min-w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-800">
                              {canEditRecord(operation) && <button type="button" onClick={(event) => { event.stopPropagation(); setActionMenuId(null); setEditingOperation(operation); }} className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"><Pencil size={16} />Редактировать</button>}
                              {canDeleteRecord(operation) && <button type="button" onClick={(event) => { event.stopPropagation(); setActionMenuId(null); handleDelete(operation); }} className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"><Trash2 size={16} />Удалить</button>}
                            </div>
                          )}
                        </div>
                      )}
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
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          {formatOperationDate(operation.operation_date || operation.created_at)}
                        </span>
                        <span className={`text-sm font-medium ${typeColor}`}>
                          {typeInfo.label}
                        </span>
                      </div>
                      <div className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                        {formatSignedAmount(operation.type, operation.amount, operation.currency || currencySymbol)}
                      </div>
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5 items-center text-sm text-gray-500 dark:text-gray-400">
                        {(() => {
                          const parts = [];
                          if (operation.type === 'transfer') {
                            const fromAcc = accountMap.get(operation.account_id);
                            const toAcc = accountMap.get(operation._linkedAccountId);
                            parts.push(
                              <span key="transfer-info" className="text-gray-600 dark:text-gray-400 text-xs">
                                {fromAcc?.name || '?'} → {toAcc?.name || '?'}
                              </span>
                            );
                          }
                          if (operation.description) {
                            parts.push(
                              <span key="desc" className="text-purple-600">
                                {operation.description}
                              </span>
                            );
                          }
                          const catName = operation.category_id
                            ? categoryMap.get(operation.category_id)?.name
                            : null;
                          if (catName) {
                            parts.push(<span key="cat" className="text-orange-500 font-medium">{catName}</span>);
                          }
                          parts.push(
                            <span key="author" className="text-gray-400 text-xs">{getAuthorText(operation)}</span>
                          );
                          return parts.reduce((acc, part, i) => {
                            if (i > 0) acc.push(<span key={`sep-${i}`} className="text-gray-300 dark:text-gray-600">·</span>);
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
                              className="min-h-11 rounded-full px-2 text-[0.7rem] italic text-green-500 hover:bg-green-50 hover:text-green-700 cursor-pointer dark:hover:bg-green-950/30"
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

                    {(canEditRecord(operation) || canDeleteRecord(operation)) && (
                      <div className="relative shrink-0" onTouchEnd={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); setActionMenuId(id => id === operation.id ? null : operation.id); }}
                          className="grid min-h-11 min-w-11 place-items-center rounded-xl text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                          aria-label="Действия с операцией"
                          aria-expanded={actionMenuId === operation.id}
                        ><MoreHorizontal size={20} /></button>
                        {actionMenuId === operation.id && (
                          <div className="absolute right-0 top-12 z-20 min-w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-800">
                            {canEditRecord(operation) && <button type="button" onClick={(event) => { event.stopPropagation(); setActionMenuId(null); setEditingOperation(operation); }} className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"><Pencil size={16} />Редактировать</button>}
                            {canDeleteRecord(operation) && <button type="button" onClick={(event) => { event.stopPropagation(); setActionMenuId(null); handleDelete(operation); }} className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"><Trash2 size={16} />Удалить</button>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {hasMore && (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 hover:border-primary-400 disabled:opacity-50"
          >
            {loadingMore ? 'Загрузка...' : `Показать ещё (${operations.length} из ${totalCount})`}
          </button>
        </div>
      )}

      {isModalOpen && (
        <AddOperationModal
          type={modalType}
          defaultCategory={modalCategory}
          workspaceId={workspaceId}
          onClose={closeModal}
          onSave={handleModalSave}
        />
      )}

      {showQuickSettings && (
        <QuickButtonsSettings
          workspaceId={workspaceId}
          buttons={quickButtons}
          onSave={updateQuickButtons}
          onClose={() => setShowQuickSettings(false)}
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
