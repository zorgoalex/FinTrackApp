import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, FileSearch, FileUp, Lock, ShieldCheck, X } from 'lucide-react';
import { supabase } from '../contexts/AuthContext';
import { useCurrencies } from '../hooks/useCurrencies';
import { parseOperationsCSV } from '../utils/importOperations';
import { categoryTypeForOperation, operationTypesForWorkspace, OPERATION_TYPE_META } from '../utils/operationTypes';
import { suggestCategory } from '../utils/documentImport/categories';
import { extractDocument } from '../utils/documentImport/extract';
import { operationFingerprint } from '../utils/documentImport/privacy';

const MAX_FILE_SIZE = 15 * 1024 * 1024;

function progressLabel(progress) {
  if (!progress) return 'Анализируем документ…';
  if (progress.stage === 'pdf') return `Читаем PDF: страница ${progress.current} из ${progress.total}`;
  if (progress.stage === 'ocr') return `Локальное распознавание: ${Math.round((progress.progress || 0) * 100)}%`;
  return 'Анализируем документ…';
}

export default function ImportOperationsModal({
  open,
  onClose,
  workspaceId,
  categories,
  accounts,
  baseCurrency,
  workspaceType,
  onImport,
  onRefresh,
}) {
  const inputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const { getRate } = useCurrencies(workspaceId);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [fileName, setFileName] = useState('');
  const [documentMeta, setDocumentMeta] = useState(null);
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState([]);
  const [fatalError, setFatalError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const activeAccounts = useMemo(() => accounts.filter((account) => !account.is_archived), [accounts]);
  const selectedRows = rows.filter((row) => row.selected);
  const invalidSelectedCount = selectedRows.filter((row) =>
    !row.operation_date
    || !row.account_id
    || !(Number(row.amount) > 0)
    || (row.currency !== baseCurrency && !(Number(row.exchange_rate) > 0))
  ).length;

  if (!open) return null;

  const resetDocument = () => {
    setFileName('');
    setDocumentMeta(null);
    setRows([]);
    setErrors([]);
    setFatalError('');
    setProgress(0);
    setProcessingProgress(null);
    if (inputRef.current) inputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const close = () => {
    if (importing || processing) return;
    resetDocument();
    setPrivacyAccepted(false);
    onClose();
  };

  const findDuplicates = async (fingerprints, documentHash) => {
    const duplicateFingerprints = new Set();
    for (let index = 0; index < fingerprints.length; index += 100) {
      const chunk = fingerprints.slice(index, index + 100);
      if (!chunk.length) continue;
      const { data } = await supabase
        .from('operations')
        .select('import_fingerprint')
        .eq('workspace_id', workspaceId)
        .in('import_fingerprint', chunk);
      (data || []).forEach((item) => duplicateFingerprints.add(item.import_fingerprint));
    }
    const { count } = await supabase
      .from('import_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('document_hash', documentHash);
    return { duplicateFingerprints, documentImportedBefore: (count || 0) > 0 };
  };

  const enrichRows = async (operations, bank, sourceKind, documentHash) => {
    const defaultAccount = activeAccounts.find((account) => account.is_default) || activeAccounts[0];
    const enriched = await Promise.all(operations.slice(0, 500).map(async (operation) => {
      const fingerprint = operation.import_fingerprint || await operationFingerprint(operation, bank);
      const account = activeAccounts.find((item) => item.currency === operation.currency)
        || (operation.currency === baseCurrency ? defaultAccount : null);
      const rate = operation.currency === baseCurrency ? 1 : getRate(operation.currency, baseCurrency, operation.operation_date);
      return {
        ...operation,
        selected: Boolean(operation.operation_date && Number(operation.amount) > 0 && (operation.confidence ?? 0.7) >= 0.68),
        duplicate: false,
        category_id: operation.category_id || suggestCategory(operation, categories),
        account_id: operation.account_id || account?.id || '',
        exchange_rate: rate || null,
        base_amount: rate ? Math.round(Number(operation.amount) * rate * 100) / 100 : Number(operation.amount),
        import_fingerprint: fingerprint,
        import_confidence: operation.confidence ?? 0.7,
        source_kind: sourceKind,
      };
    }));
    const duplicateInfo = await findDuplicates(enriched.map((row) => row.import_fingerprint), documentHash);
    return {
      rows: enriched.map((row) => duplicateInfo.duplicateFingerprints.has(row.import_fingerprint)
        ? { ...row, duplicate: true, selected: false }
        : row),
      documentImportedBefore: duplicateInfo.documentImportedBefore,
    };
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    resetDocument();
    if (!file) return;
    if (!privacyAccepted) {
      setFatalError('Подтвердите условия локальной обработки перед выбором документа');
      return;
    }
    setFileName(file.name);
    if (file.size > MAX_FILE_SIZE) {
      setFatalError('Файл больше 15 МБ. Разделите выписку на несколько частей.');
      return;
    }
    setProcessing(true);
    try {
      const extracted = await extractDocument(file, setProcessingProgress);
      let operations;
      let bank = extracted.parsed?.bank || 'unknown';
      if (extracted.sourceKind === 'csv') {
        const csvResult = parseOperationsCSV(extracted.rawText, { categories, accounts, baseCurrency, workspaceType });
        operations = csvResult.rows;
        setErrors(csvResult.errors);
        bank = 'csv';
      } else {
        operations = extracted.parsed?.operations || [];
      }
      if (!operations.length) throw new Error('Не удалось уверенно найти операции. Попробуйте более чёткий скриншот или CSV-экспорт банка.');
      const enriched = await enrichRows(operations, bank, extracted.sourceKind, extracted.documentHash);
      setRows(enriched.rows);
      setDocumentMeta({
        bank,
        sourceKind: extracted.sourceKind,
        documentHash: extracted.documentHash,
        sensitiveData: extracted.sensitiveData,
        documentImportedBefore: enriched.documentImportedBefore,
        detectedCount: operations.length,
      });
      if (operations.length > 500) setErrors((current) => [...current, 'Показаны первые 500 операций. Разделите документ на части.']);
    } catch (error) {
      setFatalError(error.message || 'Не удалось обработать документ');
    } finally {
      setProcessing(false);
      setProcessingProgress(null);
    }
  };

  const updateRow = (index, patch) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  const handleImport = async () => {
    if (!selectedRows.length || invalidSelectedCount) return;
    setImporting(true);
    setFatalError('');
    let sessionId = null;
    let completedCount = 0;
    try {
      const { data: authData } = await supabase.auth.getUser();
      const duplicateCount = rows.filter((row) => row.duplicate).length;
      const { data: session, error: sessionError } = await supabase.from('import_sessions').insert({
        workspace_id: workspaceId,
        created_by: authData.user.id,
        source_kind: documentMeta.sourceKind,
        bank: documentMeta.bank,
        document_hash: documentMeta.documentHash,
        detected_count: documentMeta.detectedCount,
        confirmed_count: selectedRows.length,
        duplicate_count: duplicateCount,
        status: 'confirmed',
      }).select('id').single();
      if (sessionError) throw sessionError;
      sessionId = session.id;
      for (let index = 0; index < selectedRows.length; index += 1) {
        const row = selectedRows[index];
        await onImport({
          ...row,
          import_session_id: sessionId,
          description: row.description || 'Импортированная операция',
          category_id: row.category_id || null,
        }, { refreshAfter: false });
        completedCount = index + 1;
        setProgress(completedCount);
      }
      await onRefresh();
      resetDocument();
      setPrivacyAccepted(false);
      onClose();
    } catch (error) {
      if (sessionId) await supabase.from('import_sessions').update({ status: 'partial', confirmed_count: completedCount }).eq('id', sessionId);
      setFatalError(`Импорт остановлен после ${completedCount} операций: ${error.message || 'ошибка сохранения'}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="max-h-[96vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl dark:bg-gray-800 sm:max-w-4xl sm:rounded-2xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-400">Безопасный импорт</p>
            <h2 id="import-title" className="text-xl font-semibold text-gray-900 dark:text-gray-100">Выписка, чек или скриншот</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Сначала проверьте черновик. Ничего не сохранится без подтверждения.</p>
          </div>
          <button type="button" onClick={close} disabled={importing || processing} className="grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Закрыть импорт"><X size={20} /></button>
        </div>

        {!documentMeta && rows.length === 0 && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 shrink-0 text-emerald-600" size={22} />
                <div className="text-sm text-emerald-950 dark:text-emerald-100">
                  <p className="font-semibold">Документ обрабатывается локально в этой вкладке</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-emerald-800 dark:text-emerald-200">
                    <li>Исходный PDF, изображение и OCR-текст не загружаются в Supabase и не передаются AI API.</li>
                    <li>ИИН/БИН, IBAN, карты, телефоны, ФИО и номера документов маскируются в описаниях.</li>
                    <li>После закрытия окна временный текст удаляется из памяти; сохраняются только подтверждённые операции и SHA-256 для поиска повторов.</li>
                  </ul>
                </div>
              </div>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
              <input type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} className="mt-1 h-4 w-4" />
              <span>Я понимаю, что финансовый документ может содержать персональные данные, и согласен на локальное распознавание и автоматическое маскирование.</span>
            </label>
            <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.csv,application/pdf,image/*,text/csv" onChange={handleFile} className="hidden" />
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />
            <button type="button" onClick={() => inputRef.current?.click()} disabled={!privacyAccepted || processing} className="flex min-h-32 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 px-4 text-center hover:border-primary-400 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:hover:bg-primary-900/20">
              {processing ? <FileSearch size={30} className="mb-2 animate-pulse text-primary-600" /> : <FileUp size={30} className="mb-2 text-primary-600" />}
              <span className="font-medium">{processing ? progressLabel(processingProgress) : 'Выбрать PDF, изображение или CSV'}</span>
              <span className="mt-1 text-xs text-gray-500">До 15 МБ · один документ за раз</span>
            </button>
            <button type="button" onClick={() => cameraInputRef.current?.click()} disabled={!privacyAccepted || processing} className="btn-secondary flex min-h-12 w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:hidden">
              <Camera size={18} /> Сканировать чек камерой
            </button>
          </div>
        )}

        {fatalError && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">{fatalError}</div>}

        {documentMeta && rows.length > 0 && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-900/50"><p className="text-xs text-gray-500">Документ</p><p className="truncate font-medium">{fileName}</p><p className="text-xs text-gray-500">{documentMeta.bank} · {documentMeta.sourceKind}</p></div>
              <div className="rounded-xl bg-green-50 p-3 dark:bg-green-900/20"><p className="text-xs text-green-700 dark:text-green-400">Выбрано</p><p className="text-2xl font-semibold text-green-800 dark:text-green-300">{selectedRows.length} / {rows.length}</p></div>
              <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-900/20"><p className="text-xs text-amber-700 dark:text-amber-400">Возможные повторы</p><p className="text-2xl font-semibold text-amber-800 dark:text-amber-300">{rows.filter((row) => row.duplicate).length}</p></div>
            </div>

            {(documentMeta.sensitiveData.length > 0 || documentMeta.documentImportedBefore) && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                <div className="flex gap-2"><Lock size={18} className="shrink-0" /><div>
                  {documentMeta.sensitiveData.length > 0 && <p>Обнаружено и скрыто: {documentMeta.sensitiveData.map((item) => `${item.label} (${item.count})`).join(', ')}.</p>}
                  {documentMeta.documentImportedBefore && <p className="font-semibold">Этот документ уже подтверждался ранее. Проверьте отмеченные повторы.</p>}
                </div></div>
              </div>
            )}

            <div className="space-y-3">
              {rows.map((row, index) => {
                const rowCategories = categories.filter((category) => !category.is_archived && category.type === categoryTypeForOperation(row.type));
                const needsRate = row.currency !== baseCurrency && !row.exchange_rate;
                return (
                  <article key={row.import_fingerprint || index} className={`rounded-xl border p-3 ${row.selected ? 'border-primary-300 dark:border-primary-700' : 'border-gray-200 opacity-70 dark:border-gray-700'}`}>
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={row.selected} onChange={(event) => updateRow(index, { selected: event.target.checked })} /> Операция {index + 1}</label>
                      <div className="flex flex-wrap justify-end gap-1 text-xs">
                        {row.duplicate && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">возможный повтор</span>}
                        {!row.selected && !row.duplicate && (row.import_confidence || 0) < 0.68 && <span className="rounded-full bg-red-100 px-2 py-1 text-red-700 dark:bg-red-900/40 dark:text-red-300">нужна ручная проверка</span>}
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-600 dark:bg-gray-700 dark:text-gray-300">уверенность {Math.round((row.import_confidence || 0) * 100)}%</span>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <input aria-label={`Дата операции ${index + 1}`} type="date" className="input-field" value={row.operation_date || ''} onChange={(event) => updateRow(index, { operation_date: event.target.value })} />
                      <select aria-label={`Тип операции ${index + 1}`} className="input-field" value={row.type} onChange={(event) => updateRow(index, { type: event.target.value, category_id: '' })}>
                        {operationTypesForWorkspace(workspaceType).filter((type) => type !== 'transfer').map((type) => <option key={type} value={type}>{OPERATION_TYPE_META[type].label}</option>)}
                      </select>
                      <div className="flex gap-2"><input aria-label={`Сумма операции ${index + 1}`} type="number" min="0.01" step="0.01" className="input-field min-w-0" value={row.amount} onChange={(event) => updateRow(index, { amount: event.target.value, base_amount: Number(event.target.value) * (Number(row.exchange_rate) || 1) })} /><span className="self-center text-xs font-medium text-gray-500">{row.currency}</span></div>
                      <select aria-label={`Счёт операции ${index + 1}`} className="input-field" value={row.account_id || ''} onChange={(event) => updateRow(index, { account_id: event.target.value })}><option value="">Выберите счёт</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select>
                      <select aria-label={`Категория операции ${index + 1}`} className="input-field sm:col-span-2" value={row.category_id || ''} onChange={(event) => updateRow(index, { category_id: event.target.value })}><option value="">Без категории</option>{rowCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
                      <input aria-label={`Описание операции ${index + 1}`} className="input-field sm:col-span-2" value={row.description || ''} maxLength={240} onChange={(event) => updateRow(index, { description: event.target.value })} />
                      {row.currency !== baseCurrency && <label className="sm:col-span-2 text-xs text-gray-500">Курс {row.currency} → {baseCurrency}<input aria-label={`Курс операции ${index + 1}`} type="number" min="0.000001" step="0.000001" className="input-field mt-1" value={row.exchange_rate || ''} onChange={(event) => updateRow(index, { exchange_rate: event.target.value, base_amount: Number(row.amount) * Number(event.target.value) })} /></label>}
                    </div>
                    {needsRate && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Нет курса {row.currency} → {baseCurrency}; проверьте сумму в базовой валюте после импорта.</p>}
                  </article>
                );
              })}
            </div>

            {errors.length > 0 && <details className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-900/20"><summary className="flex cursor-pointer items-center gap-2 font-medium text-amber-800 dark:text-amber-300"><AlertTriangle size={16} />Пропущено строк: {errors.length}</summary><ul className="mt-2 list-disc pl-5 text-amber-700 dark:text-amber-400">{errors.slice(0, 50).map((error) => <li key={error}>{error}</li>)}</ul></details>}
            {invalidSelectedCount > 0 && <p className="text-sm text-red-600">Заполните дату, сумму, счёт и курс валюты у выбранных операций.</p>}
            <div className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t border-gray-200 bg-white px-4 pt-3 dark:border-gray-700 dark:bg-gray-800 sm:static sm:mx-0 sm:flex-row sm:justify-between sm:px-0">
              <button type="button" onClick={resetDocument} disabled={importing} className="btn-secondary min-h-11">Выбрать другой файл</button>
              <button type="button" onClick={handleImport} disabled={importing || selectedRows.length === 0 || invalidSelectedCount > 0} className="btn-primary min-h-11 disabled:opacity-50">{importing ? `Сохраняем ${progress} из ${selectedRows.length}…` : <span className="flex items-center justify-center gap-2"><CheckCircle2 size={17} />Подтвердить {selectedRows.length}</span>}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
