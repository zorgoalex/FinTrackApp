export const DOCUMENT_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const PDF_MAX_PAGES = 50;
export const PDF_MAX_TEXT_ITEMS = 50_000;
export const DOCUMENT_MAX_TEXT_CHARS = 2 * 1024 * 1024;
export const IMAGE_MAX_SOURCE_PIXELS = 80_000_000;
export const IMAGE_MAX_SOURCE_DIMENSION = 20_000;

export function assertDocumentFileSize(size) {
  if (!Number.isFinite(Number(size)) || Number(size) <= 0) throw new Error('Файл пуст или имеет некорректный размер');
  if (Number(size) > DOCUMENT_MAX_FILE_BYTES) throw new Error('Файл превышает безопасный лимит 15 МБ');
}

export function assertPdfPageCount(pageCount) {
  const count = Number(pageCount);
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('PDF не содержит доступных страниц');
  if (count > PDF_MAX_PAGES) throw new Error(`PDF содержит больше ${PDF_MAX_PAGES} страниц`);
}

export function nextPdfTextBudget(current, items, text) {
  const nextItems = Number(current?.items || 0) + Number(items || 0);
  const nextChars = Number(current?.chars || 0) + String(text || '').length;
  if (nextItems > PDF_MAX_TEXT_ITEMS) throw new Error('PDF содержит слишком много текстовых элементов');
  if (nextChars > DOCUMENT_MAX_TEXT_CHARS) throw new Error('Извлечённый текст PDF превышает безопасный лимит');
  return { items: nextItems, chars: nextChars };
}

export function assertSourceImageDimensions(width, height) {
  const safeWidth = Number(width);
  const safeHeight = Number(height);
  if (!Number.isSafeInteger(safeWidth) || !Number.isSafeInteger(safeHeight) || safeWidth < 1 || safeHeight < 1) {
    throw new Error('Не удалось определить безопасный размер изображения');
  }
  if (safeWidth > IMAGE_MAX_SOURCE_DIMENSION || safeHeight > IMAGE_MAX_SOURCE_DIMENSION || safeWidth * safeHeight > IMAGE_MAX_SOURCE_PIXELS) {
    throw new Error('Размеры изображения превышают безопасный лимит');
  }
}
