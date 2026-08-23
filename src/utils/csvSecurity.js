export const CSV_MAX_CHARS = 2 * 1024 * 1024;
export const CSV_MAX_RECORDS = 5_001;
export const CSV_MAX_COLUMNS = 64;
export const CSV_MAX_CELL_CHARS = 8_192;
export const CSV_MAX_TOTAL_CELLS = 100_000;

export class CsvSecurityError extends Error {
  constructor(message, code = 'CSV_LIMIT_EXCEEDED') {
    super(message);
    this.name = 'CsvSecurityError';
    this.code = code;
  }
}

export function assertCsvTextSize(text) {
  const value = String(text ?? '');
  if (value.length > CSV_MAX_CHARS) {
    throw new CsvSecurityError('CSV превышает безопасный лимит 2 МБ', 'CSV_TOO_LARGE');
  }
  return value;
}

export function assertCsvShape({ records, columns, cellChars, totalCells }) {
  if (records > CSV_MAX_RECORDS) throw new CsvSecurityError('CSV содержит больше 5000 операций');
  if (columns > CSV_MAX_COLUMNS) throw new CsvSecurityError('CSV содержит слишком много колонок');
  if (cellChars > CSV_MAX_CELL_CHARS) throw new CsvSecurityError('Одна из ячеек CSV слишком длинная');
  if (totalCells > CSV_MAX_TOTAL_CELLS) throw new CsvSecurityError('CSV содержит слишком много ячеек');
}

export function escapeCSVCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Spreadsheet programs may ignore leading spaces before interpreting a formula.
  if (/^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  if (/[;"\r\n]/u.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}
