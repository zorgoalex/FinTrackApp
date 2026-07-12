import { useState } from 'react';
import { Archive, ArchiveRestore, Check, GitMerge, Pencil, Plus, Search, X } from 'lucide-react';
import { useCounterparties } from '../hooks/useCounterparties';

const EMPTY_FORM = {
  kind: 'both', display_name: '', legal_name: '', tax_id: '', email: '', phone: '',
  contact_person: '', default_currency: 'KZT', payment_term_days: 0,
};

const KIND_LABELS = { customer: 'Клиент', supplier: 'Поставщик', both: 'Клиент и поставщик' };

export default function CounterpartiesTab({ workspaceId, canEdit }) {
  const { counterparties, loading, error, createCounterparty, updateCounterparty, setArchived, mergeCounterparties } = useCounterparties(workspaceId);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(null);
  const [mergeSource, setMergeSource] = useState(null);
  const [mergeTarget, setMergeTarget] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');

  const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
  const visible = counterparties.filter((item) => (showArchived || !item.is_archived) && (
    !normalizedQuery || [item.display_name, item.legal_name, item.tax_id, item.email, item.phone]
      .filter(Boolean).some((value) => String(value).toLocaleLowerCase('ru-RU').includes(normalizedQuery))
  ));

  const closeForm = () => { setForm(null); setEditingId(null); };
  const startEdit = (item) => {
    setEditingId(item.id);
    setForm({ ...EMPTY_FORM, ...item, payment_term_days: item.payment_term_days || 0 });
  };

  const save = async () => {
    if (!form?.display_name.trim()) return;
    setSaving(true);
    setActionError('');
    try {
      if (editingId) await updateCounterparty(editingId, form);
      else await createCounterparty(form);
      closeForm();
    } catch (saveError) {
      setActionError(saveError.message || 'Не удалось сохранить контрагента');
    } finally {
      setSaving(false);
    }
  };

  const merge = async () => {
    if (!mergeSource || !mergeTarget) return;
    setSaving(true);
    setActionError('');
    try {
      await mergeCounterparties(mergeSource.id, mergeTarget);
      setMergeSource(null);
      setMergeTarget('');
    } catch (mergeError) {
      setActionError(mergeError.message || 'Не удалось объединить контрагентов');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Загрузка контрагентов…</p>;

  return <div className="space-y-3">
    {(error || actionError) && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{actionError || error}</p>}
    <div className="flex flex-col gap-2 sm:flex-row">
      <label className="relative flex-1"><Search size={17} className="absolute left-3 top-3.5 text-gray-400" /><span className="sr-only">Поиск контрагента</span><input className="input-field min-h-11 pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, БИН/ИИН, email…" /></label>
      <button type="button" onClick={() => setShowArchived((value) => !value)} className="btn-secondary flex min-h-11 items-center justify-center gap-2">{showArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />}{showArchived ? 'Скрыть архив' : 'Показать архив'}</button>
    </div>

    {form && <CounterpartyForm form={form} setForm={setForm} saving={saving} onSave={save} onClose={closeForm} />}

    {mergeSource && <div className="rounded-xl border border-primary-200 bg-primary-50 p-3 dark:border-primary-900 dark:bg-primary-950/30">
      <p className="text-sm font-medium">Куда перенести связи «{mergeSource.display_name}»?</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row"><select className="input-field min-h-11 flex-1" value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}><option value="">Выберите основной контакт</option>{counterparties.filter((item) => item.id !== mergeSource.id && !item.is_archived).map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select><button type="button" className="btn-primary min-h-11" disabled={!mergeTarget || saving} onClick={merge}>Объединить</button><button type="button" className="btn-secondary min-h-11" onClick={() => setMergeSource(null)}>Отмена</button></div>
      <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">Операции и долги будут перенесены, исходный контакт — архивирован.</p>
    </div>}

    {visible.length === 0 && <p className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700">Контрагенты не найдены</p>}
    {visible.map((item) => <article key={item.id} className={`rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800 ${item.is_archived ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium text-gray-900 dark:text-gray-100">{item.display_name}</h3><span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">{KIND_LABELS[item.kind]}</span>{item.is_archived && <span className="text-xs text-gray-500">архив</span>}</div><p className="mt-1 text-xs text-gray-500">{[item.tax_id && `БИН/ИИН ${item.tax_id}`, item.contact_person, item.phone, item.email].filter(Boolean).join(' · ') || 'Контактные данные не заполнены'}</p></div>
      {canEdit && <div className="flex shrink-0"><button type="button" onClick={() => startEdit(item)} disabled={item.is_archived} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-primary-600 disabled:opacity-30 dark:hover:bg-gray-700" aria-label={`Редактировать ${item.display_name}`}><Pencil size={16} /></button><button type="button" onClick={() => { setMergeSource(item); setMergeTarget(''); }} disabled={item.is_archived} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-primary-600 disabled:opacity-30 dark:hover:bg-gray-700" aria-label={`Объединить ${item.display_name}`}><GitMerge size={16} /></button><button type="button" onClick={() => setArchived(item.id, !item.is_archived).catch((archiveError) => setActionError(archiveError.message))} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-orange-600 dark:hover:bg-gray-700" aria-label={item.is_archived ? `Вернуть ${item.display_name}` : `Архивировать ${item.display_name}`}>{item.is_archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button></div>}
      </div>
    </article>)}
    {canEdit && !form && <button type="button" onClick={() => { setEditingId(null); setForm({ ...EMPTY_FORM }); }} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary-300 text-sm text-primary-600 hover:bg-primary-50 dark:border-primary-700 dark:text-primary-400 dark:hover:bg-primary-950/30"><Plus size={16} />Добавить контрагента</button>}
  </div>;
}

function CounterpartyForm({ form, setForm, saving, onSave, onClose }) {
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  return <div className="rounded-xl border border-primary-200 bg-white p-3 dark:border-primary-800 dark:bg-gray-800">
    <div className="grid gap-2 sm:grid-cols-2"><input autoFocus className="input-field" value={form.display_name} onChange={set('display_name')} placeholder="Отображаемое название *" /><select className="input-field" value={form.kind} onChange={set('kind')}><option value="customer">Клиент</option><option value="supplier">Поставщик</option><option value="both">Клиент и поставщик</option></select><input className="input-field" value={form.legal_name || ''} onChange={set('legal_name')} placeholder="Юридическое название" /><input className="input-field" value={form.tax_id || ''} onChange={set('tax_id')} placeholder="БИН/ИИН" /><input className="input-field" type="email" value={form.email || ''} onChange={set('email')} placeholder="Email" /><input className="input-field" value={form.phone || ''} onChange={set('phone')} placeholder="Телефон" /><input className="input-field" value={form.contact_person || ''} onChange={set('contact_person')} placeholder="Контактное лицо" /><label className="text-xs text-gray-500">Срок оплаты, дней<input className="input-field mt-1" type="number" min="0" max="3650" value={form.payment_term_days} onChange={set('payment_term_days')} /></label></div>
    <div className="mt-3 flex justify-end gap-2"><button type="button" className="btn-secondary grid min-h-11 min-w-11 place-items-center" onClick={onClose} aria-label="Отмена"><X size={18} /></button><button type="button" className="btn-primary flex min-h-11 items-center gap-2" onClick={onSave} disabled={saving || !form.display_name.trim()}><Check size={18} />Сохранить</button></div>
  </div>;
}
