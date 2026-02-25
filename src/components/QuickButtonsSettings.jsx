import { useState } from 'react';
import { X, Trash2, Pencil, Check } from 'lucide-react';
import useCategories from '../hooks/useCategories';

export default function QuickButtonsSettings({ workspaceId, buttons, onSave, onClose }) {
  const { categories } = useCategories(workspaceId);
  const [list, setList] = useState(buttons || []);
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState('expense');
  const [newCategory, setNewCategory] = useState('');
  const [editIndex, setEditIndex] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const filteredCategories = categories.filter((c) => c.type === newType);

  const resetForm = () => {
    setNewLabel('');
    setNewType('expense');
    setNewCategory('');
    setEditIndex(null);
  };

  const handleAdd = () => {
    const label = newLabel.trim() || newCategory;
    if (!label) return;
    const entry = { label, type: newType, category: newCategory || label };

    if (editIndex !== null) {
      setList((prev) => prev.map((btn, i) => (i === editIndex ? entry : btn)));
    } else {
      setList((prev) => [...prev, entry]);
    }
    resetForm();
  };

  const handleEdit = (index) => {
    const btn = list[index];
    setNewLabel(btn.label);
    setNewType(btn.type);
    setNewCategory(btn.category);
    setEditIndex(index);
  };

  const handleRemove = (index) => {
    setList((prev) => prev.filter((_, i) => i !== index));
    if (editIndex === index) resetForm();
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave(list);
      onClose();
    } catch (err) {
      setError(err.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-base font-semibold text-gray-800">Быстрые кнопки</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Current buttons */}
          {list.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">Текущие кнопки</p>
              {list.map((btn, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg ${
                    editIndex === i ? 'bg-indigo-50 border border-indigo-200' : 'bg-gray-50'
                  }`}
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-gray-800">{btn.label}</span>
                    <span className="text-xs text-gray-500 ml-2">
                      {btn.type === 'income' ? 'доход' : 'расход'} · {btn.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleEdit(i)}
                      className="text-gray-400 hover:text-indigo-600"
                      title="Редактировать"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => handleRemove(i)}
                      className="text-red-400 hover:text-red-600"
                      title="Удалить"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add / Edit form */}
          {(list.length < 5 || editIndex !== null) && (
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium text-gray-700">
              {editIndex !== null ? 'Редактировать кнопку' : `Добавить кнопку (${list.length}/5)`}
            </p>

            <div className="flex gap-2">
              <select
                value={newType}
                onChange={(e) => { setNewType(e.target.value); setNewCategory(''); }}
                className="input-field text-sm w-28"
              >
                <option value="income">Доход</option>
                <option value="expense">Расход</option>
              </select>

              <select
                value={newCategory}
                onChange={(e) => {
                  setNewCategory(e.target.value);
                  if (!newLabel) setNewLabel(e.target.value);
                }}
                className="input-field text-sm flex-1"
              >
                <option value="">Выберите категорию</option>
                {filteredCategories.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Название кнопки"
                className="input-field text-sm flex-1"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
              />
              {editIndex !== null ? (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={!newCategory && !newLabel.trim()}
                    className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    title="Применить"
                  >
                    <Check size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={resetForm}
                    className="px-3 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={!newCategory && !newLabel.trim()}
                  className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  Добавить
                </button>
              )}
            </div>
          </div>
          )}

          {list.length >= 5 && editIndex === null && (
            <p className="text-sm text-gray-500 border-t pt-4">Достигнут лимит — максимум 5 кнопок.</p>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* Save / Cancel */}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">
              Отмена
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-white text-sm font-medium bg-indigo-600 hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
