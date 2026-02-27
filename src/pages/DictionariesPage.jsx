import { useState, useEffect, useCallback } from 'react';
import { Pencil, Trash2, Plus, X, Check, Archive, ArchiveRestore } from 'lucide-react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { usePermissions } from '../hooks/usePermissions';
import { useCategories } from '../hooks/useCategories';
import { useTags } from '../hooks/useTags';

const TABS = [
  { key: 'categories', label: 'Категории' },
  { key: 'tags', label: 'Теги' },
];

function DeleteAlert({ message, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="bg-red-900/50 border border-red-500 text-red-300 rounded p-3 text-sm flex items-center justify-between">
      <span>{message}</span>
      <button onClick={onClose} className="ml-2 text-red-400 hover:text-red-200">
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
      <h1 className="text-xl font-semibold text-gray-900 mb-4">Справочники</h1>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-4">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'categories' ? (
        <CategoriesTab workspaceId={workspaceId} canEdit={hasManagementRights} />
      ) : (
        <TagsTab workspaceId={workspaceId} canEdit={hasManagementRights} />
      )}
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

  if (loading) return <p className="text-sm text-gray-500">Загрузка...</p>;
  if (error) return <p className="text-sm text-red-500">{error}</p>;

  const visibleCategories = showArchived ? categories : categories.filter((c) => !c.is_archived);

  return (
    <div className="space-y-2">
      {deleteError && <DeleteAlert message={deleteError} onClose={clearDeleteError} />}

      <div className="flex justify-end mb-1">
        <button
          data-testid="archive-toggle"
          onClick={() => setShowArchived((v) => !v)}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded px-2 py-1"
        >
          {showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          {showArchived ? 'Скрыть архивные' : 'Показать архивные'}
        </button>
      </div>

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
            className={`flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-2${cat.is_archived ? ' opacity-60' : ''}`}
          >
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: cat.color || '#6B7280' }}
              />
              <span className="text-sm text-gray-900">{cat.name}</span>
              <span
                className={`text-xs px-1.5 py-0.5 rounded ${
                  cat.type === 'income'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                }`}
              >
                {cat.type === 'income' ? 'Доход' : 'Расход'}
              </span>
              {cat.is_archived && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">архив</span>
              )}
            </div>
            {canEdit && (
              <div className="flex items-center gap-1">
                {!cat.is_archived && (
                  <button onClick={() => startEdit(cat)} className="p-1 text-gray-400 hover:text-blue-600">
                    <Pencil size={16} />
                  </button>
                )}
                {!cat.is_archived ? (
                  <button
                    data-testid={`archive-btn-${cat.id}`}
                    onClick={() => handleArchive(cat.id)}
                    className="p-1 text-gray-400 hover:text-orange-500"
                    title="Архивировать"
                  >
                    <Archive size={16} />
                  </button>
                ) : (
                  <>
                    <button
                      data-testid={`unarchive-btn-${cat.id}`}
                      onClick={() => handleUnarchive(cat.id)}
                      className="p-1 text-gray-400 hover:text-blue-600"
                      title="Разархивировать"
                    >
                      <ArchiveRestore size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(cat.id)}
                      className="p-1 text-gray-400 hover:text-red-600"
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
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 mt-2"
        >
          <Plus size={16} /> Добавить категорию
        </button>
      )}
    </div>
  );
}

function InlineCategoryForm({ form, setForm, onSave, onCancel, saving }) {
  return (
    <div className="flex flex-wrap items-center gap-2 bg-white border border-blue-200 rounded-lg px-4 py-2">
      <input
        type="text"
        placeholder="Название"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        className="flex-1 min-w-[120px] text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
        autoFocus
      />
      <select
        value={form.type}
        onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
        className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="income">Доход</option>
        <option value="expense">Расход</option>
      </select>
      <input
        type="color"
        value={form.color}
        onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
        className="w-8 h-8 p-0 border border-gray-300 rounded cursor-pointer"
      />
      <button
        onClick={onSave}
        disabled={saving || !form.name.trim()}
        className="p-1 text-green-600 hover:text-green-700 disabled:opacity-40"
      >
        <Check size={18} />
      </button>
      <button onClick={onCancel} className="p-1 text-gray-400 hover:text-gray-600">
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

  if (loading) return <p className="text-sm text-gray-500">Загрузка...</p>;
  if (error) return <p className="text-sm text-red-500">{error}</p>;

  const visibleTags = showArchived ? tags : tags.filter((t) => !t.is_archived);

  return (
    <div className="space-y-2">
      {deleteError && <DeleteAlert message={deleteError} onClose={clearDeleteError} />}

      <div className="flex justify-end mb-1">
        <button
          data-testid="archive-toggle"
          onClick={() => setShowArchived((v) => !v)}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded px-2 py-1"
        >
          {showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          {showArchived ? 'Скрыть архивные' : 'Показать архивные'}
        </button>
      </div>

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
            className={`flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-2${tag.is_archived ? ' opacity-60' : ''}`}
          >
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: tag.color || '#6B7280' }}
              />
              <span className="text-sm text-gray-900">{tag.name}</span>
              {tag.is_archived && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">архив</span>
              )}
            </div>
            {canEdit && (
              <div className="flex items-center gap-1">
                {!tag.is_archived && (
                  <button onClick={() => startEdit(tag)} className="p-1 text-gray-400 hover:text-blue-600">
                    <Pencil size={16} />
                  </button>
                )}
                {!tag.is_archived ? (
                  <button
                    data-testid={`archive-btn-${tag.id}`}
                    onClick={() => handleArchive(tag.id)}
                    className="p-1 text-gray-400 hover:text-orange-500"
                    title="Архивировать"
                  >
                    <Archive size={16} />
                  </button>
                ) : (
                  <>
                    <button
                      data-testid={`unarchive-btn-${tag.id}`}
                      onClick={() => handleUnarchive(tag.id)}
                      className="p-1 text-gray-400 hover:text-blue-600"
                      title="Разархивировать"
                    >
                      <ArchiveRestore size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(tag.id)}
                      className="p-1 text-gray-400 hover:text-red-600"
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
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 mt-2"
        >
          <Plus size={16} /> Добавить тег
        </button>
      )}
    </div>
  );
}

function InlineTagForm({ form, setForm, onSave, onCancel, saving }) {
  return (
    <div className="flex flex-wrap items-center gap-2 bg-white border border-blue-200 rounded-lg px-4 py-2">
      <input
        type="text"
        placeholder="Название"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        className="flex-1 min-w-[120px] text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
        autoFocus
      />
      <input
        type="color"
        value={form.color}
        onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
        className="w-8 h-8 p-0 border border-gray-300 rounded cursor-pointer"
      />
      <button
        onClick={onSave}
        disabled={saving || !form.name.trim()}
        className="p-1 text-green-600 hover:text-green-700 disabled:opacity-40"
      >
        <Check size={18} />
      </button>
      <button onClick={onCancel} className="p-1 text-gray-400 hover:text-gray-600">
        <X size={18} />
      </button>
    </div>
  );
}
