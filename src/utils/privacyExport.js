export const PRIVACY_EXPORT_FORMAT = 'fintrack-account-privacy-export';
export const PRIVACY_EXPORT_VERSION = 1;

export function privacyExportFilename(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  return `fintrack_my_data_${day}.json`;
}

async function parseInvokeError(error) {
  try {
    const payload = await error?.context?.json();
    return payload?.error || payload?.message || '';
  } catch {
    return '';
  }
}

export async function downloadMyPrivacyExport(supabase, date = new Date()) {
  const { data, error } = await supabase.functions.invoke('privacy-export', {
    body: { format: 'json' },
  });
  if (error) {
    const serverMessage = await parseInvokeError(error);
    throw new Error(serverMessage || 'Не удалось подготовить экспорт данных');
  }
  if (!(data instanceof Blob) || data.size === 0) {
    throw new Error('Сервер вернул пустой файл экспорта');
  }

  const url = URL.createObjectURL(data);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = privacyExportFilename(date);
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
  return { bytes: data.size, filename: privacyExportFilename(date) };
}
