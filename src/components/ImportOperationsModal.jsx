import { useRef, useState } from 'react';
import { AlertTriangle, FileUp, X } from 'lucide-react';
import { parseOperationsCSV } from '../utils/importOperations';

export default function ImportOperationsModal({
  open,
  onClose,
  categories,
  accounts,
  baseCurrency,
  onImport,
  onRefresh,
}) {
  const inputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState([]);
  const [fatalError, setFatalError] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  if (!open) return null;

  const reset = () => {
    setFileName('');
    setRows([]);
    setErrors([]);
    setFatalError('');
    setProgress(0);
    if (inputRef.current) inputRef.current.value = '';
  };

  const close = () => {
    if (importing) return;
    reset();
    onClose();
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    reset();
    if (!file) return;
    setFileName(file.name);
    if (file.size > 2 * 1024 * 1024) {
      setFatalError('Файл больше 2 МБ. Разделите его на несколько частей.');
      return;
    }
    try {
      const result = parseOperationsCSV(await file.text(), { categories, accounts, baseCurrency });
      setRows(result.rows.slice(0, 500));
      setErrors(result.errors);
      if (result.rows.length > 500) {
        setErrors((current) => [...current, 'За один раз можно импортировать не более 500 корректных строк.']);
      }
    } catch {
      setFatalError('Не удалось прочитать CSV-файл. Проверьте его кодировку и формат.');
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setFatalError('');
    try {
      for (let index = 0; index < rows.length; index += 1) {
        await onImport(rows[index], { refreshAfter: false });
        setProgress(index + 1);
      }
      await onRefresh();
      close();
    } catch (error) {
      setFatalError(`Импорт остановлен после ${progress} строк: ${error.message || 'ошибка сохранения'}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-gray-800 sm:max-w-xl sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="import-title" className="text-xl font-semibold text-gray-900 dark:text-gray-100">Импорт операций из CSV</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Доходы, расходы и зарплаты. Переводы создавайте через интерфейс.</p>
          </div>
          <button type="button" onClick={close} disabled={importing} className="grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Закрыть импорт">
            <X size={20} />
          </button>
        </div>

        <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={importing} className="flex min-h-28 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 px-4 text-center hover:border-primary-400 hover:bg-primary-50 dark:border-gray-600 dark:hover:bg-primary-900/20">
          <FileUp size={28} className="mb-2 text-primary-600" />
          <span className="font-medium">{fileName || 'Выбрать CSV-файл'}</span>
          <span className="mt-1 text-xs text-gray-500">До 2 МБ и 500 операций за один импорт</span>
        </button>

        {fatalError && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">{fatalError}</div>}

        {(rows.length > 0 || errors.length > 0) && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-green-50 p-3 dark:bg-green-900/20"><p className="text-xs text-green-700 dark:text-green-400">Готово к импорту</p><p className="text-2xl font-semibold text-green-800 dark:text-green-300">{rows.length}</p></div>
              <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-900/20"><p className="text-xs text-amber-700 dark:text-amber-400">Пропущено</p><p className="text-2xl font-semibold text-amber-800 dark:text-amber-300">{errors.length}</p></div>
            </div>
            {errors.length > 0 && (
              <details className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-900/20">
                <summary className="flex cursor-pointer items-center gap-2 font-medium text-amber-800 dark:text-amber-300"><AlertTriangle size={16} />Показать пропущенные строки</summary>
                <ul className="mt-2 max-h-36 list-disc space-y-1 overflow-y-auto pl-5 text-amber-700 dark:text-amber-400">{errors.slice(0, 50).map((error) => <li key={error}>{error}</li>)}</ul>
              </details>
            )}
          </div>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={close} disabled={importing} className="btn-secondary min-h-11">Отмена</button>
          <button type="button" onClick={handleImport} disabled={importing || rows.length === 0} className="btn-primary min-h-11 disabled:opacity-50">
            {importing ? `Импорт ${progress} из ${rows.length}…` : `Импортировать ${rows.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}
