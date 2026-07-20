import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import { detectSensitiveData, sha256Hex } from './privacy.js';
import { parseBankDocumentText } from './parsers.js';
import {
  calculateOcrImageSize,
  OCR_TIMEOUT_MS,
  runWithOcrDeadline,
} from './ocrPolicy.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

let ocrWorkerPromise = null;
let ocrProgressListener = null;

function invalidateOcrWorker() {
  const staleWorkerPromise = ocrWorkerPromise;
  ocrWorkerPromise = null;
  ocrProgressListener = null;
  if (staleWorkerPromise) {
    Promise.resolve(staleWorkerPromise)
      .then((worker) => worker.terminate())
      .catch(() => {});
  }
}

async function getOcrWorker(onProgress) {
  ocrProgressListener = onProgress;
  if (!ocrWorkerPromise) {
    let creationPromise;
    creationPromise = import('tesseract.js')
      .then(async ({ createWorker, PSM }) => {
        const worker = await createWorker('rus+eng', 1, {
          workerPath: tesseractWorkerUrl,
          logger: (message) => {
            ocrProgressListener?.({
              stage: 'ocr',
              status: message.status || '',
              progress: message.progress || 0,
            });
          },
        });
        if (ocrWorkerPromise !== creationPromise) {
          await worker.terminate();
          const error = new Error('Распознавание отменено');
          error.name = 'AbortError';
          throw error;
        }
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.AUTO,
          preserve_interword_spaces: '1',
        });
        return worker;
      })
      .catch((error) => {
        if (ocrWorkerPromise === creationPromise) ocrWorkerPromise = null;
        throw error;
      });
    ocrWorkerPromise = creationPromise;
  }
  return ocrWorkerPromise;
}

function detectBinaryKind(buffer) {
  const bytes = new Uint8Array(buffer.slice(0, 16));
  const ascii = String.fromCharCode(...bytes);
  if (ascii.startsWith('%PDF-')) return 'pdf';
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image';
  if (bytes[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return 'image';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image';
  const hasBinaryNull = new Uint8Array(buffer.slice(0, 512)).includes(0);
  return hasBinaryNull ? 'unknown' : 'text';
}

function groupPdfItems(items) {
  const lines = new Map();
  items.forEach((item) => {
    const y = Math.round((item.transform?.[5] || 0) / 3) * 3;
    if (!lines.has(y)) lines.set(y, []);
    lines.get(y).push({ x: item.transform?.[4] || 0, text: item.str || '' });
  });
  return Array.from(lines.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((part) => part.text).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

async function extractPdfText(file, onProgress) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    pages.push(groupPdfItems(content.items));
    onProgress?.({ stage: 'pdf', current: index, total: pdf.numPages });
  }
  return pages.join('\n');
}

async function extractImageText(file, onProgress, { signal, timeoutMs = OCR_TIMEOUT_MS } = {}) {
  try {
    return await runWithOcrDeadline(async () => {
      onProgress?.({ stage: 'preparing', progress: 0 });
      let imageForOcr = file;
      if (globalThis.createImageBitmap && globalThis.document) {
        const bitmap = await globalThis.createImageBitmap(file);
        const target = calculateOcrImageSize(bitmap.width, bitmap.height);
        const canvas = globalThis.document.createElement('canvas');
        canvas.width = target.width;
        canvas.height = target.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Браузер не поддерживает подготовку изображения для OCR');
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let index = 0; index < pixels.data.length; index += 4) {
          const gray = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
          const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
          pixels.data[index] = contrasted;
          pixels.data[index + 1] = contrasted;
          pixels.data[index + 2] = contrasted;
        }
        context.putImageData(pixels, 0, 0);
        imageForOcr = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png')) || file;
      }
      onProgress?.({ stage: 'preparing', progress: 1 });
      const worker = await getOcrWorker(onProgress);
      const result = await worker.recognize(imageForOcr);
      return { text: result.data.text || '', confidence: Number(result.data.confidence) || 0 };
    }, {
      signal,
      timeoutMs,
      onCancel: invalidateOcrWorker,
    });
  } catch (error) {
    if (!['AbortError', 'OcrTimeoutError'].includes(error.name)) invalidateOcrWorker();
    throw error;
  } finally {
    ocrProgressListener = null;
  }
}

async function extractScannedPdf(file, onProgress, options) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  if (pdf.numPages > 5) throw new Error('Сканированный PDF длиннее 5 страниц. Разделите его на части для локального OCR.');
  const texts = [];
  let confidenceTotal = 0;
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const image = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const ocr = await extractImageText(
      image,
      (progress) => onProgress?.({ ...progress, page: index, pages: pdf.numPages }),
      options,
    );
    texts.push(ocr.text);
    confidenceTotal += ocr.confidence;
  }
  return { text: texts.join('\n'), confidence: confidenceTotal / pdf.numPages };
}

export async function extractDocument(file, onProgress, options = {}) {
  const buffer = await file.arrayBuffer();
  const documentHash = await sha256Hex(buffer);
  const binaryKind = detectBinaryKind(buffer);
  const type = file.type || '';
  const extension = file.name.split('.').pop()?.toLowerCase();
  let text = '';
  let ocrConfidence = null;
  let sourceKind = 'image';
  if ((type === 'text/csv' || extension === 'csv') && binaryKind === 'text') {
    sourceKind = 'csv';
    text = new globalThis.TextDecoder('utf-8').decode(buffer);
  } else if ((type === 'application/pdf' || extension === 'pdf') && binaryKind === 'pdf') {
    sourceKind = 'pdf';
    try {
      text = await extractPdfText(file, onProgress);
    } catch (error) {
      throw new Error(`PDF повреждён или имеет неподдерживаемую структуру: ${error.message}`);
    }
    if (text.replace(/\s/g, '').length < 40) {
      const ocr = await extractScannedPdf(file, onProgress, options);
      text = ocr.text;
      ocrConfidence = ocr.confidence;
    }
  } else if ((type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp'].includes(extension)) && binaryKind === 'image') {
    const ocr = await extractImageText(file, onProgress, options);
    text = ocr.text;
    ocrConfidence = ocr.confidence;
  } else {
    throw new Error('Содержимое файла не соответствует PDF, JPG, PNG, WEBP или CSV. Расширение файла не считается достаточной проверкой.');
  }
  const parsed = sourceKind === 'csv' ? null : await parseBankDocumentText(text, ocrConfidence !== null ? 'image' : sourceKind);
  if (parsed && ocrConfidence !== null) {
    parsed.operations = parsed.operations.map((operation) => ({
      ...operation,
      confidence: Math.min(operation.confidence || 1, ocrConfidence / 100),
    }));
  }
  return {
    documentHash,
    sourceKind,
    rawText: text,
    sensitiveData: detectSensitiveData(text),
    ocrConfidence,
    parsed,
  };
}
