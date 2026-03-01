import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../contexts/AuthContext';

export function useCurrencies(workspaceId) {
  const [currencies, setCurrencies] = useState([]);
  const [exchangeRates, setExchangeRates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadCurrencies = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: loadErr } = await supabase
        .from('currencies')
        .select('code, symbol, name_ru, name_en, decimal_digits, is_active')
        .eq('is_active', true)
        .order('code', { ascending: true });

      if (loadErr) throw loadErr;
      setCurrencies(data || []);
    } catch (e) {
      console.error('useCurrencies: loadCurrencies error', e);
      setError(e.message || 'Ошибка загрузки валют');
      setCurrencies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadExchangeRates = useCallback(async () => {
    if (!workspaceId) {
      setExchangeRates([]);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const { data, error: loadErr } = await supabase
        .from('exchange_rates')
        .select('id, workspace_id, from_currency, to_currency, rate, rate_date, source, created_at')
        .eq('workspace_id', workspaceId)
        .order('rate_date', { ascending: false });

      if (loadErr) throw loadErr;
      setExchangeRates(data || []);
    } catch (e) {
      console.error('useCurrencies: loadExchangeRates error', e);
      setError(e.message || 'Ошибка загрузки курсов');
      setExchangeRates([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const setExchangeRate = useCallback(async (fromCurrency, toCurrency, rate, rateDate, source = 'manual') => {
    if (!workspaceId) {
      setError('Рабочее пространство не выбрано');
      return null;
    }
    try {
      setError(null);
      const { data, error: upsertErr } = await supabase
        .from('exchange_rates')
        .upsert(
          {
            workspace_id: workspaceId,
            from_currency: fromCurrency,
            to_currency: toCurrency,
            rate: Number(rate),
            rate_date: rateDate,
            source,
          },
          { onConflict: 'workspace_id,from_currency,to_currency,rate_date' }
        )
        .select('id, workspace_id, from_currency, to_currency, rate, rate_date, source, created_at')
        .single();

      if (upsertErr) throw upsertErr;
      await loadExchangeRates();
      return data;
    } catch (e) {
      console.error('useCurrencies: setExchangeRate error', e);
      setError(e.message || 'Ошибка сохранения курса');
      return null;
    }
  }, [workspaceId, loadExchangeRates]);

  const deleteExchangeRate = useCallback(async (id) => {
    if (!workspaceId) {
      setError('Рабочее пространство не выбрано');
      return false;
    }
    try {
      setError(null);
      const { error: deleteErr } = await supabase
        .from('exchange_rates')
        .delete()
        .eq('id', id)
        .eq('workspace_id', workspaceId);

      if (deleteErr) throw deleteErr;
      await loadExchangeRates();
      return true;
    } catch (e) {
      console.error('useCurrencies: deleteExchangeRate error', e);
      setError(e.message || 'Ошибка удаления курса');
      return false;
    }
  }, [workspaceId, loadExchangeRates]);

  const fetchAutoRates = useCallback(async () => {
    if (!workspaceId) return null;
    try {
      setError(null);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-rates`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ workspace_id: workspaceId }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Ошибка ${response.status}`);
      }

      const result = await response.json();
      await loadExchangeRates();
      return result;
    } catch (e) {
      console.error('useCurrencies: fetchAutoRates error', e);
      setError(e.message || 'Ошибка автоматического обновления курсов');
      return null;
    }
  }, [workspaceId, loadExchangeRates]);

  const getRate = useCallback((fromCurrency, toCurrency, date) => {
    if (fromCurrency === toCurrency) return 1;

    const dateStr = typeof date === 'string' ? date : date?.toISOString?.()?.slice(0, 10);

    // 1. Direct rate for exact date
    const direct = exchangeRates.find(
      (r) => r.from_currency === fromCurrency && r.to_currency === toCurrency && r.rate_date === dateStr
    );
    if (direct) return Number(direct.rate);

    // 2. Reverse rate for exact date
    const reverse = exchangeRates.find(
      (r) => r.from_currency === toCurrency && r.to_currency === fromCurrency && r.rate_date === dateStr
    );
    if (reverse && Number(reverse.rate) !== 0) return 1 / Number(reverse.rate);

    // 3. Latest available direct rate (rates sorted by date desc)
    const latestDirect = exchangeRates.find(
      (r) => r.from_currency === fromCurrency && r.to_currency === toCurrency
    );
    if (latestDirect) return Number(latestDirect.rate);

    // 4. Latest available reverse rate
    const latestReverse = exchangeRates.find(
      (r) => r.from_currency === toCurrency && r.to_currency === fromCurrency
    );
    if (latestReverse && Number(latestReverse.rate) !== 0) return 1 / Number(latestReverse.rate);

    return null;
  }, [exchangeRates]);

  const convertToBase = useCallback((amount, fromCurrency, date, baseCurrency) => {
    if (fromCurrency === baseCurrency) {
      return { baseAmount: Number(amount), rate: 1 };
    }

    const rate = getRate(fromCurrency, baseCurrency, date);
    if (rate === null) {
      return { baseAmount: null, rate: null };
    }

    return {
      baseAmount: Number(amount) * rate,
      rate,
    };
  }, [getRate]);

  const getCurrencySymbol = useCallback((code) => {
    const c = currencies.find(c => c.code === code);
    return c?.symbol || code;
  }, [currencies]);

  const refresh = useCallback(async () => {
    await Promise.all([loadCurrencies(), loadExchangeRates()]);
  }, [loadCurrencies, loadExchangeRates]);

  useEffect(() => {
    loadCurrencies();
  }, [loadCurrencies]);

  useEffect(() => {
    loadExchangeRates();
  }, [loadExchangeRates]);

  return {
    currencies,
    exchangeRates,
    loading,
    error,
    loadCurrencies,
    loadExchangeRates,
    setExchangeRate,
    deleteExchangeRate,
    fetchAutoRates,
    getRate,
    convertToBase,
    getCurrencySymbol,
    refresh,
  };
}

export default useCurrencies;
