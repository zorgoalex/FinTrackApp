import { useState, useEffect, useCallback } from 'react';
import { Pencil, Trash2, Plus, X, Check, Archive, ArchiveRestore, BrainCircuit, Power } from 'lucide-react';
import { supabase } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { usePermissions } from '../hooks/usePermissions';
import { useCategories } from '../hooks/useCategories';
import { useTags } from '../hooks/useTags';
import { useAccounts } from '../hooks/useAccounts';
import { useCurrencies } from '../hooks/useCurrencies';
import { OPERATION_TYPE_META } from '../utils/operationTypes';
import CounterpartiesTab from '../components/CounterpartiesTab';

const TABS = [
  { key: 'categories', label: 'Категории' },
  { key: 'tags', label: 'Теги' },
  { key: 'accounts', label: 'Счета' },
  { key: 'counterparties', label: 'Контрагенты' },
  { key: 'rules', label: 'Правила' },
];

function DeleteAlert({ message, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="bg-red-900/50 border border-red-500 text-red-300 rounded p-3 text-sm flex items-center justify-between">
      <span>{message}</span>
      <button onClick={onClose} aria-label="Закрыть сообщение" className="ml-2 grid min-h-11 min-w-11 place-items-center rounded-lg text-red-400 hover:bg-red-900/30 hover:text-red-200">
        <X size={16} />
      </button>
    </div>
  );
}

export default function DictionariesPage() {
  const { workspaceId } = useWorkspace();
  const { hasManagementRights } = usePermissions();
  const [activeTab, setActiveTab] = useState('categories');

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">Справочники</h1>

      {/* Tabs */}
      <div className="grid grid-cols-2 gap-x-1 border-b border-gray-200 dark:border-gray-700 mb-4 sm:grid-cols-5" role="tablist" aria-label="Разделы справочников">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`min-h-11 px-2 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'categories' ? (
        <CategoriesTab workspaceId={workspaceId} canEdit={hasManagementRights} />
      ) : activeTab === 'tags' ? (
        <TagsTab workspaceId={workspaceId} canEdit={hasManagementRights} />
      ) : activeTab === 'accounts' ? (
        <AccountsTab workspaceId={workspaceId} canEdit={hasManagementRights} />
      ) : activeTab === 'counterparties' ? (
        <CounterpartiesTab workspaceId={workspaceId} canEdit={hasManagementRights} />
      ) : (
        <CategoryRulesTab workspaceId={workspaceId} canEdit={hasManagementRights} />
      )}
    </div>
  );
}

/* ─── Learned category rules ─── */
function CategoryRulesTab({ workspaceId, canEdit }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadRules = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError('');
    const { data, error: loadError } = await supabase
      .from('category_rules')
      .select('id, operation_type, pattern, priority, is_active, created_at, categories(name, color)')
      .eq('workspace_id', workspaceId)
      .order('is_active', { ascending: false })
      .order('updated_at', { ascending: false });
    if (loadError) setError(loadError.message);
    setRules(data || []);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { loadRules(); }, [loadRules]);

  const toggleRule = async (rule) => {
    const { error: updateError } = await supabase.from('category_rules')
      .update({ is_active: !rule.is_active, updated_at: new Date().toISOString() })
      .eq('id', rule.id);
    if (updateError) setError(updateError.message);
    else await loadRules();
  };

  const deleteRule = async (rule) => {
    if (!window.confirm(`Удалить правило «${rule.pattern}»?`)) return;
    const { error: deleteError } = await supabase.from('category_rules').delete().eq('id', rule.id);
    if (deleteError) setError(deleteError.message);
    else await loadRules();
  };

  if (loading) return <p className="text-sm text-gray-500 dark:text-gray-400">Загрузка правил…</p>;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-primary-200 bg-primary-50 p-3 text-sm text-primary-900 dark:border-primary-900 dark:bg-primary-950/30 dark:text-primary-200">
        <div className="flex gap-2"><BrainCircuit size={19} className="shrink-0" /><p>Правила создаются в предпросмотре импорта через «Запомнить категорию» и применяются ко всем следующим выпискам пространства.</p></div>
      </div>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
      {rules.length === 0 && <p className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">Обучаемых правил пока нет. Импортируйте выписку и запомните категорию нужной операции.</p>}
      {rules.map((rule) => (
        <article key={rule.id} className={`flex min-h-16 items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800 ${rule.is_active ? '' : 'opacity-60'}`}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium text-gray-900 dark:text-gray-100">«{rule.pattern}»</span>
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">{OPERATION_TYPE_META[rule.operation_type]?.label || rule.operation_type}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: rule.categories?.color || '#6B7280' }} />
              Категория: {rule.categories?.name || 'удалена'}
            </div>
          </div>
          {canEdit && <div className="flex shrink-0 items-center gap-1">
            <button onClick={() => toggleRule(rule)} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-primary-600 dark:hover:bg-gray-700" aria-label={rule.is_active ? `Отключить правило ${rule.pattern}` : `Включить правило ${rule.pattern}`} title={rule.is_active ? 'Отключить' : 'Включить'}><Power size={16} /></button>
            <button onClick={() => deleteRule(rule)} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30" aria-label={`Удалить правило ${rule.pattern}`} title="Удалить"><Trash2 size={16} /></button>
          </div>}
        </article>
      ))}
    </div>
  );
}

/* ─── Categories Tab ─── */
function CategoriesTab({ workspaceId, canEdit }) {
  const { categories, loading, error, addCategory, updateCategory, deleteCategory, archiveCategory, unarchiveCategory } = useCategories(workspaceId);
  const [editingId, setEditingId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'expense', color: '#6B7280' });
  const [saving, setSaving] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const clearDeleteError = useCallback(() => setDeleteError(null), []);

  const resetForm = () => {
    setForm({ name: '', type: 'expense', color: '#6B7280' });
    setEditingId(null);
    setShowAdd(false);
  };

  const startEdit = (cat) => {
    setEditingId(cat.id);
    setForm({ name: cat.name, type: cat.type, color: cat.color || '#6B7280' });
    setShowAdd(false);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    if (editingId) {
      await updateCategory(editingId, form);
    } else {
      await addCategory(form);
    }
    setSaving(false);
    resetForm();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Удалить категорию?')) return;
    const result = await deleteCategory(id);
    if (result?.error) {
      setDeleteError(result.error);
    }
  };

  const handleArchive = async (id) => {
    const result = await archiveCategory(id);
    if (result?.error) {
      setDeleteError(result.error);
    }
  };

  const handleUnarchive = async (id) => {
    const result = await unarchiveCategory(id);
    if (result?.error) {
      setDeleteError(result.error);
    }
  };

  if (loading) return <p className="text-sm text-gray-500 dark:text-gray-400">Загрузка...</p>;
  if (error) return <p className="text-sm text-red-500 dark:text-red-400">{error}</p>;

  const visibleCategories = showArchived ? categories : categories.filter((c) => !c.is_archived);

  return (
    <div className="space-y-2">
      {deleteError && <DeleteAlert message={deleteError} onClose={clearDeleteError} />}

      <div className="flex justify-end mb-1">
        <button
          data-testid="archive-toggle"
          onClick={() => setShowArchived((v) => !v)}
          className="flex min-h-11 items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2"
        >
          {showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          {showArchived ? 'Скрыть архивные' : 'Показать архивные'}
        </button>
      </div>

      {visibleCategories.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">{showArchived ? 'Архивных категорий нет' : 'Категорий пока нет'}</p>
      )}

      {visibleCategories.map((cat) =>
        editingId === cat.id ? (
          <InlineCategoryForm
            key={cat.id}
            form={form}
            setForm={setForm}
            onSave={handleSave}
            onCancel={resetForm}
            saving={saving}
          />
        ) : (
          <div
            key={cat.id}
            className={`flex min-h-14 items-center justify-between gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2${cat.is_archived ? ' opacity-60' : ''}`}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: cat.color || '#6B7280' }}
              />
              <span className="text-sm text-gray-900 dark:text-gray-100">{cat.name}</span>
              <span
                className={`text-xs px-1.5 py-0.5 rounded ${
                  cat.type === 'income'
                    ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                    : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400'
                }`}
              >
                {cat.type === 'income' ? 'Доход' : 'Расход'}
              </span>
              {cat.is_archived && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">архив</span>
              )}
            </div>
            {canEdit && (
              <div className="flex items-center gap-1">
                {!cat.is_archived && (
                  <button onClick={() => startEdit(cat)} aria-label={`Редактировать категорию ${cat.name}`} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-primary-600 dark:hover:bg-gray-700 dark:hover:text-primary-400">
                    <Pencil size={16} />
                  </button>
                )}
                {!cat.is_archived ? (
                  <button
                    data-testid={`archive-btn-${cat.id}`}
                    onClick={() => handleArchive(cat.id)}
                    aria-label={`Архивировать категорию ${cat.name}`}
                    className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-orange-500 dark:hover:bg-gray-700 dark:hover:text-orange-400"
                    title="Архивировать"
                  >
                    <Archive size={16} />
                  </button>
                ) : (
                  <>
                    <button
                      data-testid={`unarchive-btn-${cat.id}`}
                      onClick={() => handleUnarchive(cat.id)}
                      aria-label={`Разархивировать категорию ${cat.name}`}
                      className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-primary-600 dark:hover:bg-gray-700 dark:hover:text-primary-400"
                      title="Разархивировать"
                    >
                      <ArchiveRestore size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(cat.id)}
                      aria-label={`Удалить категорию ${cat.name}`}
                      className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-700 dark:hover:text-red-400"
                      title="Удалить"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )
      )}

      {showAdd && (
        <InlineCategoryForm
          form={form}
          setForm={setForm}
          onSave={handleSave}
          onCancel={resetForm}
          saving={saving}
        />
      )}

      {canEdit && !showAdd && !editingId && (
        <button
          onClick={() => { resetForm(); setShowAdd(true); }}
          className="flex min-h-11 w-full items-center justify-center gap-1 rounded-xl border border-dashed border-primary-300 text-sm text-primary-600 dark:border-primary-700 dark:text-primary-400 hover:bg-primary-50 hover:text-primary-700 dark:hover:bg-primary-950/30 dark:hover:text-primary-300 mt-2"
        >
          <Plus size={16} /> Добавить категорию
        </button>
      )}
    </div>
  );
}

function InlineCategoryForm({ form, setForm, onSave, onCancel, saving }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2 bg-white dark:bg-gray-800 border border-primary-200 dark:border-primary-700 rounded-xl p-3 sm:flex sm:flex-wrap">
      <input
        type="text"
        placeholder="Название"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        aria-label="Название категории"
        className="min-h-11 min-w-0 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:flex-1 sm:min-w-[120px]"
        autoFocus
      />
      <select
        value={form.type}
        onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
        aria-label="Тип категории"
        className="min-h-11 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500"
      >
        <option value="income">Доход</option>
        <option value="expense">Расход</option>
      </select>
      <input
        type="color"
        value={form.color}
        onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
        aria-label="Цвет категории"
        className="h-11 w-11 p-1 border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer"
      />
      <button
        onClick={onSave}
        disabled={saving || !form.name.trim()}
        aria-label="Сохранить категорию"
        className="grid min-h-11 min-w-11 place-items-center rounded-lg text-green-600 dark:text-green-400 hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-950/30 dark:hover:text-green-300 disabled:opacity-40"
      >
        <Check size={18} />
      </button>
      <button onClick={onCancel} aria-label="Отменить редактирование категории" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300">
        <X size={18} />
      </button>
    </div>
  );
}

/* ─── Tags Tab ─── */
function TagsTab({ workspaceId, canEdit }) {
  const { tags, loading, error, addTag, updateTag, deleteTag, archiveTag, unarchiveTag } = useTags(workspaceId);
  const [editingId, setEditingId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState({ name: '', color: '#6B7280' });
  const [saving, setSaving] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const clearDeleteError = useCallback(() => setDeleteError(null), []);

  const resetForm = () => {
    setForm({ name: '', color: '#6B7280' });
    setEditingId(null);
    setShowAdd(false);
  };

  const startEdit = (tag) => {
    setEditingId(tag.id);
    setForm({ name: tag.name, color: tag.color || '#6B7280' });
    setShowAdd(false);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    if (editingId) {
      await updateTag(editingId, form);
    } else {
      await addTag(form);
    }
    setSaving(false);
    resetForm();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Удалить тег?')) return;
    const result = await deleteTag(id);
    if (result?.error) {
      setDeleteError(result.error);
    }
  };

  const handleArchive = async (id) => {
    const result = await archiveTag(id);
    if (result?.error) {
      setDeleteError(result.error);
    }
  };

  const handleUnarchive = async (id) => {
    const result = await unarchiveTag(id);
    if (result?.error) {
      setDeleteError(result.error);
    }
  };

  if (loading) return <p className="text-sm text-gray-500 dark:text-gray-400">Загрузка...</p>;
  if (error) return <p className="text-sm text-red-500 dark:text-red-400">{error}</p>;

  const visibleTags = showArchived ? tags : tags.filter((t) => !t.is_archived);

  return (
    <div className="space-y-2">
      {deleteError && <DeleteAlert message={deleteError} onClose={clearDeleteError} />}

      <div className="flex justify-end mb-1">
        <button
          data-testid="archive-toggle"
          onClick={() => setShowArchived((v) => !v)}
          className="flex min-h-11 items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2"
        >
          {showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          {showArchived ? 'Скрыть архивные' : 'Показать архивные'}
        </button>
      </div>

      {visibleTags.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">{showArchived ? 'Архивных тегов нет' : 'Тегов пока нет'}</p>
      )}

      {visibleTags.map((tag) =>
        editingId === tag.id ? (
          <InlineTagForm
            key={tag.id}
            form={form}
            setForm={setForm}
            onSave={handleSave}
            onCancel={resetForm}
            saving={saving}
          />
        ) : (
          <div
            key={tag.id}
            className={`flex min-h-14 items-center justify-between gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2${tag.is_archived ? ' opacity-60' : ''}`}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: tag.color || '#6B7280' }}
              />
              <span className="text-sm text-gray-900 dark:text-gray-100">{tag.name}</span>
              {tag.is_archived && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">архив</span>
              )}
            </div>
            {canEdit && (
              <div className="flex items-center gap-1">
                {!tag.is_archived && (
                  <button onClick={() => startEdit(tag)} aria-label={`Редактировать тег ${tag.name}`} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-primary-600 dark:hover:bg-gray-700 dark:hover:text-primary-400">
                    <Pencil size={16} />
                  </button>
                )}
                {!tag.is_archived ? (
                  <button
                    data-testid={`archive-btn-${tag.id}`}
                    onClick={() => handleArchive(tag.id)}
                    aria-label={`Архивировать тег ${tag.name}`}
                    className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-orange-500 dark:hover:bg-gray-700 dark:hover:text-orange-400"
                    title="Архивировать"
                  >
                    <Archive size={16} />
                  </button>
                ) : (
                  <>
                    <button
                      data-testid={`unarchive-btn-${tag.id}`}
                      onClick={() => handleUnarchive(tag.id)}
                      aria-label={`Разархивировать тег ${tag.name}`}
                      className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-primary-600 dark:hover:bg-gray-700 dark:hover:text-primary-400"
                      title="Разархивировать"
                    >
                      <ArchiveRestore size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(tag.id)}
                      aria-label={`Удалить тег ${tag.name}`}
                      className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-700 dark:hover:text-red-400"
                      title="Удалить"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )
      )}

      {showAdd && (
        <InlineTagForm
          form={form}
          setForm={setForm}
          onSave={handleSave}
          onCancel={resetForm}
          saving={saving}
        />
      )}

      {canEdit && !showAdd && !editingId && (
        <button
          onClick={() => { resetForm(); setShowAdd(true); }}
          className="flex min-h-11 w-full items-center justify-center gap-1 rounded-xl border border-dashed border-primary-300 text-sm text-primary-600 dark:border-primary-700 dark:text-primary-400 hover:bg-primary-50 hover:text-primary-700 dark:hover:bg-primary-950/30 dark:hover:text-primary-300 mt-2"
        >
          <Plus size={16} /> Добавить тег
        </button>
      )}
    </div>
  );
}

function InlineTagForm({ form, setForm, onSave, onCancel, saving }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 bg-white dark:bg-gray-800 border border-primary-200 dark:border-primary-700 rounded-xl p-3 sm:flex sm:flex-wrap">
      <input
        type="text"
        placeholder="Название"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        aria-label="Название тега"
        className="min-h-11 min-w-0 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:flex-1 sm:min-w-[120px]"
        autoFocus
      />
      <input
        type="color"
        value={form.color}
        onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
        aria-label="Цвет тега"
        className="h-11 w-11 p-1 border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer"
      />
      <button
        onClick={onSave}
        disabled={saving || !form.name.trim()}
        aria-label="Сохранить тег"
        className="grid min-h-11 min-w-11 place-items-center rounded-lg text-green-600 dark:text-green-400 hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-950/30 dark:hover:text-green-300 disabled:opacity-40"
      >
        <Check size={18} />
      </button>
      <button onClick={onCancel} aria-label="Отменить редактирование тега" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300">
        <X size={18} />
      </button>
    </div>
  );
}

/* ─── Accounts Tab ─── */
function AccountsTab({ workspaceId, canEdit }) {
  const { accounts, loading, error, addAccount, updateAccount, deleteAccount, archiveAccount, unarchiveAccount } = useAccounts(workspaceId);
  const { currencies } = useCurrencies(workspaceId);
  const [editingId, setEditingId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const emptyAccount = () => ({
    name: '',
    color: '#6B7280',
    currency: 'KZT',
    opening_balance: '0',
    opening_date: new Date().toISOString().slice(0, 10),
  });
  const [form, setForm] = useState(emptyAccount);
  const [saving, setSaving] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const clearDeleteError = useCallback(() => setDeleteError(null), []);

  const resetForm = () => {
    setForm(emptyAccount());
    setEditingId(null);
    setShowAdd(false);
  };

  const startEdit = (acc) => {
    setEditingId(acc.id);
    setForm({
      name: acc.name,
      color: acc.color || '#6B7280',
      currency: acc.currency || 'KZT',
      opening_balance: String(acc.opening_balance ?? 0),
      opening_date: acc.opening_date || new Date().toISOString().slice(0, 10),
    });
    setShowAdd(false);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    if (editingId) {
      await updateAccount(editingId, form);
    } else {
      await addAccount(form);
    }
    setSaving(false);
    resetForm();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Удалить счёт?')) return;
    const result = await deleteAccount(id);
    if (result?.error) {
      setDeleteError(result.error);
    }
  };

  const handleArchive = async (id) => {
    const result = await archiveAccount(id);
    if (result?.error) {
      setDeleteError(result.error);
    }
  };

  const handleUnarchive = async (id) => {
    const result = await unarchiveAccount(id);
    if (result?.error) {
      setDeleteError(result.error);
    }
  };

  if (loading) return <p className="text-sm text-gray-500 dark:text-gray-400">Загрузка...</p>;
  if (error) return <p className="text-sm text-red-500 dark:text-red-400">{error}</p>;

  const visibleAccounts = showArchived ? accounts : accounts.filter((a) => !a.is_archived);

  return (
    <div className="space-y-2">
      {deleteError && <DeleteAlert message={deleteError} onClose={clearDeleteError} />}

      <div className="flex justify-end mb-1">
        <button
          onClick={() => setShowArchived((v) => !v)}
          className="flex min-h-11 items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2"
        >
          {showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          {showArchived ? 'Скрыть архивные' : 'Показать архивные'}
        </button>
      </div>

      {visibleAccounts.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">{showArchived ? 'Архивных счетов нет' : 'Счетов пока нет'}</p>
      )}

      {visibleAccounts.map((acc) =>
        editingId === acc.id ? (
          <InlineAccountForm
            key={acc.id}
            form={form}
            setForm={setForm}
            onSave={handleSave}
            onCancel={resetForm}
            saving={saving}
            currencies={currencies}
          />
        ) : (
          <div
            key={acc.id}
            className={`flex min-h-14 items-center justify-between gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2${acc.is_archived ? ' opacity-60' : ''}`}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: acc.color || '#6B7280' }}
              />
              <span className="text-sm text-gray-900 dark:text-gray-100">{acc.name}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{acc.currency || 'KZT'}</span>
              {(Number(acc.opening_balance) !== 0) && (
                <span className="text-xs text-gray-500 dark:text-gray-400">старт: {Number(acc.opening_balance).toLocaleString('ru-RU')} · {acc.opening_date}</span>
              )}
              {acc.is_default && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400">основной</span>
              )}
              {acc.is_archived && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">архив</span>
              )}
            </div>
            {canEdit && (
              <div className="flex items-center gap-1">
                {!acc.is_archived && (
                  <button onClick={() => startEdit(acc)} aria-label={`Редактировать счёт ${acc.name}`} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-primary-600 dark:hover:bg-gray-700 dark:hover:text-primary-400">
                    <Pencil size={16} />
                  </button>
                )}
                {!acc.is_archived && !acc.is_default ? (
                  <button
                    onClick={() => handleArchive(acc.id)}
                    aria-label={`Архивировать счёт ${acc.name}`}
                    className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-orange-500 dark:hover:bg-gray-700 dark:hover:text-orange-400"
                    title="Архивировать"
                  >
                    <Archive size={16} />
                  </button>
                ) : acc.is_archived ? (
                  <>
                    <button
                      onClick={() => handleUnarchive(acc.id)}
                      aria-label={`Разархивировать счёт ${acc.name}`}
                      className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-primary-600 dark:hover:bg-gray-700 dark:hover:text-primary-400"
                      title="Разархивировать"
                    >
                      <ArchiveRestore size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(acc.id)}
                      aria-label={`Удалить счёт ${acc.name}`}
                      className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-700 dark:hover:text-red-400"
                      title="Удалить"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : null}
              </div>
            )}
          </div>
        )
      )}

      {showAdd && (
        <InlineAccountForm
          form={form}
          setForm={setForm}
          onSave={handleSave}
          onCancel={resetForm}
          saving={saving}
          currencies={currencies}
        />
      )}

      {canEdit && !showAdd && !editingId && (
        <button
          onClick={() => { resetForm(); setShowAdd(true); }}
          className="flex min-h-11 w-full items-center justify-center gap-1 rounded-xl border border-dashed border-primary-300 text-sm text-primary-600 dark:border-primary-700 dark:text-primary-400 hover:bg-primary-50 hover:text-primary-700 dark:hover:bg-primary-950/30 dark:hover:text-primary-300 mt-2"
        >
          <Plus size={16} /> Добавить счёт
        </button>
      )}
    </div>
  );
}

function InlineAccountForm({ form, setForm, onSave, onCancel, saving, currencies }) {
  return (
    <div className="grid grid-cols-2 items-center gap-2 bg-white dark:bg-gray-800 border border-primary-200 dark:border-primary-700 rounded-xl p-3 sm:flex sm:flex-wrap">
      <input
        type="text"
        placeholder="Название счёта"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        aria-label="Название счёта"
        className="col-span-2 min-h-11 min-w-0 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:flex-1 sm:min-w-[120px]"
        autoFocus
      />
      <select
        value={form.currency || 'KZT'}
        onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
        aria-label="Валюта счёта"
        className="min-h-11 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500"
      >
        {(currencies || []).map((currency) => (
          <option key={currency.code} value={currency.code}>
            {currency.symbol} {currency.code}
          </option>
        ))}
      </select>
      <label className="col-span-2 grid grid-cols-2 items-center gap-2 text-xs text-gray-500 sm:col-span-1 sm:flex sm:items-center">
        <span>Начальный остаток</span>
        <input
          type="number"
          step="0.01"
          value={form.opening_balance ?? '0'}
          onChange={(e) => setForm((f) => ({ ...f, opening_balance: e.target.value }))}
          className="input-field min-h-11 min-w-0 sm:w-32"
        />
      </label>
      <label className="col-span-2 grid grid-cols-2 items-center gap-2 text-xs text-gray-500 sm:col-span-1 sm:flex sm:items-center">
        <span>На дату</span>
        <input
          type="date"
          value={form.opening_date || ''}
          onChange={(e) => setForm((f) => ({ ...f, opening_date: e.target.value }))}
          className="input-field min-h-11 min-w-0 sm:w-40"
        />
      </label>
      <input
        type="color"
        value={form.color}
        onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
        aria-label="Цвет счёта"
        className="h-11 w-11 p-1 border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer"
      />
      <button
        onClick={onSave}
        disabled={saving || !form.name.trim()}
        aria-label="Сохранить счёт"
        className="grid min-h-11 min-w-11 place-items-center rounded-lg text-green-600 dark:text-green-400 hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-950/30 dark:hover:text-green-300 disabled:opacity-40"
      >
        <Check size={18} />
      </button>
      <button onClick={onCancel} aria-label="Отменить редактирование счёта" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300">
        <X size={18} />
      </button>
    </div>
  );
}
