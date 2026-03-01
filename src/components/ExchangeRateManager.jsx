import { useState } from 'react';
import { Trash2, RefreshCw, Plus } from 'lucide-react';
import { useCurrencies } from '../hooks/useCurrencies';
import CurrencySelector from './CurrencySelector';

function ExchangeRateManager({ workspaceId, baseCurrency }) {
  const {
    currencies,
    exchangeRates,
    loading,
    error,
    setExchangeRate,
    deleteExchangeRate,
    fetchAutoRates,
    refresh,
  } = useCurrencies(workspaceId);

  const [fromCurrency, setFromCurrency] = useState('');
  const [toCurrency, setToCurrency] = useState(baseCurrency || '');
  const [rate, setRate] = useState('');
  const [rateDate, setRateDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [fetchingAuto, setFetchingAuto] = useState(false);
  const [localError, setLocalError] = useState(null);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!fromCurrency || !toCurrency || !rate || !rateDate) {
      setLocalError('Заполните все поля');
      return;
    }
    if (fromCurrency === toCurrency) {
      setLocalError('Валюты должны отличаться');
      return;
    }
    const rateNum = Number(rate);
    if (!rateNum || rateNum <= 0) {
      setLocalError('Курс должен быть положительным числом');
      return;
    }

    try {
      setSubmitting(true);
      setLocalError(null);
      const result = await setExchangeRate(fromCurrency, toCurrency, rateNum, rateDate, 'manual');
      if (result) {
        setFromCurrency('');
        setRate('');
      }
    } catch (err) {
      setLocalError(err.message || 'Ошибка добавления курса');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Удалить этот курс?')) return;
    await deleteExchangeRate(id);
  };

  const handleFetchAutoRates = async () => {
    try {
      setFetchingAuto(true);
      setLocalError(null);
      await fetchAutoRates();
    } catch (err) {
      console.error('ExchangeRateManager: fetchAutoRates error', err);
      setLocalError(err.message || 'Ошибка обновления курсов');
    } finally {
      setFetchingAuto(false);
    }
  };

  const sourceLabel = (source) => {
    switch (source) {
      case 'manual': return 'Вручную';
      case 'cbr': return 'ЦБ РФ';
      case 'openexchangerates': return 'Open ER';
      default: return source || '—';
    }
  };

  const displayError = localError || error;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Курсы валют
        </h3>
        <button
          type="button"
          onClick={handleFetchAutoRates}
          disabled={fetchingAuto || loading}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${fetchingAuto ? 'animate-spin' : ''}`} />
          Обновить курсы
        </button>
      </div>

      {displayError && (
        <div className="p-3 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
          {displayError}
        </div>
      )}

      {/* Add form */}
      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex-1 min-w-[120px]">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Из</label>
          <CurrencySelector currencies={currencies} value={fromCurrency} onChange={setFromCurrency} disabled={submitting} />
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">В</label>
          <CurrencySelector currencies={currencies} value={toCurrency} onChange={setToCurrency} disabled={submitting} />
        </div>
        <div className="flex-1 min-w-[100px]">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Курс</label>
          <input
            type="number"
            step="any"
            min="0"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="0.00"
            disabled={submitting}
            className="input-field text-sm"
          />
        </div>
        <div className="flex-1 min-w-[130px]">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Дата</label>
          <input
            type="date"
            value={rateDate}
            onChange={(e) => setRateDate(e.target.value)}
            disabled={submitting}
            className="input-field text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={submitting || loading}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Добавить
        </button>
      </form>

      {/* Rates table */}
      {exchangeRates.length === 0 && !loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
          Курсы валют ещё не добавлены
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400">
                <th className="text-left px-4 py-2.5 font-medium">Из</th>
                <th className="text-left px-4 py-2.5 font-medium">В</th>
                <th className="text-right px-4 py-2.5 font-medium">Курс</th>
                <th className="text-left px-4 py-2.5 font-medium">Дата</th>
                <th className="text-left px-4 py-2.5 font-medium">Источник</th>
                <th className="px-4 py-2.5 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {exchangeRates.map((r) => (
                <tr key={r.id} className="bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="px-4 py-2.5 text-gray-900 dark:text-gray-100 font-medium">{r.from_currency}</td>
                  <td className="px-4 py-2.5 text-gray-900 dark:text-gray-100 font-medium">{r.to_currency}</td>
                  <td className="px-4 py-2.5 text-right text-gray-900 dark:text-gray-100 tabular-nums">{Number(r.rate).toFixed(4)}</td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{r.rate_date}</td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{sourceLabel(r.source)}</td>
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => handleDelete(r.id)}
                      className="p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                      title="Удалить курс"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading && (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">Загрузка...</p>
      )}
    </div>
  );
}

export default ExchangeRateManager;
