const BACKUP_FORMAT = 'fintrack-workspace-backup';
const BACKUP_VERSION = 2;
const PAGE_SIZE = 1000;

const WORKSPACE_TABLES = [
  ['accounts', 'accounts'],
  ['categories', 'categories'],
  ['tags', 'tags'],
  ['counterparties', 'counterparties'],
  ['operations', 'operations'],
  ['operation_allocations', 'operationAllocations'],
  ['scheduled_operations', 'scheduledOperations'],
  ['debts', 'debts'],
  ['exchange_rates', 'exchangeRates'],
  ['budgets', 'budgets'],
  ['import_sessions', 'importSessions'],
  ['import_templates', 'importTemplates'],
  ['category_rules', 'categoryRules'],
  ['cashflow_plans', 'cashflowPlans'],
  ['operation_comments', 'operationComments'],
  ['savings_goals', 'savingsGoals'],
  ['savings_goal_contributions', 'savingsGoalContributions'],
];

const BACKUP_DATA_KEYS = WORKSPACE_TABLES.map(([, key]) => key).concat('operationTags');

async function fetchAllWorkspaceRows(supabase, table, workspaceId) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('workspace_id', workspaceId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Не удалось выгрузить ${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchOperationTags(supabase, operationIds) {
  const rows = [];
  for (let index = 0; index < operationIds.length; index += 500) {
    const ids = operationIds.slice(index, index + 500);
    const { data, error } = await supabase
      .from('operation_tags')
      .select('operation_id, tag_id')
      .in('operation_id', ids);
    if (error) throw new Error(`Не удалось выгрузить связи тегов: ${error.message}`);
    rows.push(...(data || []));
  }
  return rows;
}

export function buildWorkspaceBackupDocument({ workspace, data, exportedAt = new Date().toISOString() }) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    workspace: { ...workspace },
    data: {
      accounts: data.accounts || [],
      categories: data.categories || [],
      tags: data.tags || [],
      counterparties: data.counterparties || [],
      operations: data.operations || [],
      operationAllocations: data.operationAllocations || [],
      operationTags: data.operationTags || [],
      scheduledOperations: data.scheduledOperations || [],
      debts: data.debts || [],
      exchangeRates: data.exchangeRates || [],
      budgets: data.budgets || [],
      importSessions: data.importSessions || [],
      importTemplates: data.importTemplates || [],
      operationComments: data.operationComments || [],
      categoryRules: data.categoryRules || [],
      cashflowPlans: data.cashflowPlans || [],
      savingsGoals: data.savingsGoals || [],
      savingsGoalContributions: data.savingsGoalContributions || [],
    },
  };
}

export function validateWorkspaceBackupDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Файл не содержит JSON-объект резервной копии');
  if (value.format !== BACKUP_FORMAT) throw new Error('Неизвестный формат резервной копии');
  if (value.version !== BACKUP_VERSION) throw new Error(`Нужна резервная копия версии ${BACKUP_VERSION}. Создайте новую копию перед восстановлением`);
  if (!value.workspace?.id || !value.workspace?.name || !value.data || typeof value.data !== 'object') throw new Error('В резервной копии отсутствуют обязательные разделы');

  const counts = {};
  for (const key of BACKUP_DATA_KEYS) {
    const rows = value.data[key] ?? [];
    if (!Array.isArray(rows)) throw new Error(`Раздел ${key} должен быть массивом`);
    if (rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error(`Раздел ${key} содержит некорректную запись`);
    counts[key] = rows.length;
  }
  const totalRows = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return { backup: value, counts, totalRows };
}

export async function restoreWorkspaceBackup(supabase, workspaceId, backup, dryRun = true) {
  const validated = validateWorkspaceBackupDocument(backup);
  const { data, error } = await supabase.rpc('restore_workspace_backup', {
    p_workspace_id: workspaceId,
    p_backup: validated.backup,
    p_dry_run: dryRun,
  });
  if (error) throw new Error(`Не удалось ${dryRun ? 'проверить' : 'восстановить'} копию: ${error.message}`);
  return data;
}

export async function createWorkspaceBackup(supabase, workspaceId) {
  const { data: workspace, error: workspaceError } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', workspaceId)
    .single();
  if (workspaceError) {
    throw new Error(`Не удалось выгрузить настройки пространства: ${workspaceError.message}`);
  }

  const results = await Promise.all(
    WORKSPACE_TABLES.map(async ([table, key]) => [
      key,
      await fetchAllWorkspaceRows(supabase, table, workspaceId)
    ])
  );
  const data = Object.fromEntries(results);
  data.operationTags = await fetchOperationTags(
    supabase,
    data.operations.map((operation) => operation.id)
  );

  return buildWorkspaceBackupDocument({ workspace, data });
}

export function workspaceBackupFilename(workspaceName, date = new Date()) {
  const safeName = String(workspaceName || 'workspace')
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'workspace';
  const day = date.toISOString().slice(0, 10);
  return `fintrack_backup_${safeName}_${day}.json`;
}

export function downloadWorkspaceBackup(backup) {
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = workspaceBackupFilename(backup.workspace?.name, new Date(backup.exportedAt));
  anchor.click();
  URL.revokeObjectURL(url);
}
