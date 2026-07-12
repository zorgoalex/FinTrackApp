import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../contexts/AuthContext';

export function useCounterparties(workspaceId, { includeArchived = true } = {}) {
  const [counterparties, setCounterparties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId) {
      setCounterparties([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const query = supabase
      .from('counterparties')
      .select('id, workspace_id, kind, display_name, legal_name, tax_id, email, phone, contact_person, default_currency, payment_term_days, is_archived, merged_into_id, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .order('is_archived')
      .order('display_name');
    if (!includeArchived) query.eq('is_archived', false);
    const { data, error: loadError } = await query;
    setCounterparties(data || []);
    setError(loadError?.message || '');
    setLoading(false);
  }, [includeArchived, workspaceId]);

  useEffect(() => { load(); }, [load]);

  const createCounterparty = async (values) => {
    const { data: authData } = await supabase.auth.getUser();
    const { data, error: saveError } = await supabase.from('counterparties').insert({
      workspace_id: workspaceId,
      created_by: authData.user?.id,
      kind: values.kind,
      display_name: values.display_name.trim(),
      legal_name: values.legal_name?.trim() || null,
      tax_id: values.tax_id?.trim() || null,
      email: values.email?.trim() || null,
      phone: values.phone?.trim() || null,
      contact_person: values.contact_person?.trim() || null,
      default_currency: values.default_currency || 'KZT',
      payment_term_days: Number(values.payment_term_days) || 0,
    }).select().single();
    if (saveError) throw saveError;
    await load();
    return data;
  };

  const updateCounterparty = async (id, values) => {
    const { error: saveError } = await supabase.from('counterparties').update({
      kind: values.kind,
      display_name: values.display_name.trim(),
      legal_name: values.legal_name?.trim() || null,
      tax_id: values.tax_id?.trim() || null,
      email: values.email?.trim() || null,
      phone: values.phone?.trim() || null,
      contact_person: values.contact_person?.trim() || null,
      default_currency: values.default_currency || 'KZT',
      payment_term_days: Number(values.payment_term_days) || 0,
    }).eq('workspace_id', workspaceId).eq('id', id);
    if (saveError) throw saveError;
    await load();
  };

  const setArchived = async (id, isArchived) => {
    const { error: archiveError } = await supabase.from('counterparties')
      .update({ is_archived: isArchived })
      .eq('workspace_id', workspaceId)
      .eq('id', id);
    if (archiveError) throw archiveError;
    await load();
  };

  const mergeCounterparties = async (sourceId, targetId) => {
    const { error: mergeError } = await supabase.rpc('merge_counterparties', {
      p_source_id: sourceId,
      p_target_id: targetId,
    });
    if (mergeError) throw mergeError;
    await load();
  };

  return { counterparties, loading, error, refresh: load, createCounterparty, updateCounterparty, setArchived, mergeCounterparties };
}

export default useCounterparties;
