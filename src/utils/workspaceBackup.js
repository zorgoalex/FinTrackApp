const BACKUP_FORMAT = 'fintrack-workspace-backup';
const BACKUP_VERSION = 1;
const PAGE_SIZE = 1000;

const WORKSPACE_TABLES = [
  ['accounts', 'accounts'],
  ['categories', 'categories'],
  ['tags', 'tags'],
  ['operations', 'operations'],
  ['scheduled_operations', 'scheduledOperations'],
  ['debts', 'debts'],
  ['exchange_rates', 'exchangeRates'],
  ['budgets', 'budgets'],
  ['import_sessions', 'importSessions'],
];

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
      operations: data.operations || [],
      operationTags: data.operationTags || [],
      scheduledOperations: data.scheduledOperations || [],
      debts: data.debts || [],
      exchangeRates: data.exchangeRates || [],
      budgets: data.budgets || [],
      importSessions: data.importSessions || [],
    },
  };
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
