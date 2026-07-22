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
let paddleOcrPromise = null;
let paddleProgressListener = null;

const PADDLE_CYRILLIC_MODEL_URL = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/cyrillic_PP-OCRv5_mobile_rec_onnx_infer.tar';

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

function invalidatePaddleOcr() {
  const stalePromise = paddleOcrPromise;
  paddleOcrPromise = null;
  paddleProgressListener = null;
  if (stalePromise) {
    Promise.resolve(stalePromise)
      .then((ocr) => ocr.dispose())
      .catch(() => {});
  }
}

async function getPaddleOcr(onProgress) {
  paddleProgressListener = onProgress;
  if (!paddleOcrPromise) {
    let creationPromise;
    creationPromise = import('@paddleocr/paddleocr-js')
      .then(async ({ PaddleOCR }) => {
        paddleProgressListener?.({ stage: 'ocr', engine: 'paddle', status: 'loading-model', progress: 0 });
        const ocr = await PaddleOCR.create({
          textDetectionModelName: 'PP-OCRv5_mobile_det',
          textRecognitionModelName: 'cyrillic_PP-OCRv5_mobile_rec',
          textRecognitionModelAsset: { url: PADDLE_CYRILLIC_MODEL_URL },
          textRecognitionBatchSize: 8,
          worker: true,
          ortOptions: {
            backend: 'wasm',
            wasmPaths: '/ort/',
            numThreads: 1,
            simd: true,
          },
        });
        if (paddleOcrPromise !== creationPromise) {
          ocr.dispose();
          const error = new Error('Распознавание отменено');
          error.name = 'AbortError';
          throw error;
        }
        paddleProgressListener?.({ stage: 'ocr', engine: 'paddle', status: 'model-ready', progress: 1 });
        return ocr;
      })
      .catch((error) => {
        if (paddleOcrPromise === creationPromise) paddleOcrPromise = null;
        throw error;
      });
    paddleOcrPromise = creationPromise;
  }
  return paddleOcrPromise;
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

async function imageCanvas(file, rotation = 0, monochrome = false) {
  const bitmap = await globalThis.createImageBitmap(file);
  const target = calculateOcrImageSize(bitmap.width, bitmap.height);
  const quarterTurn = Math.abs(rotation) % 180 === 90;
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = quarterTurn ? target.height : target.width;
  canvas.height = quarterTurn ? target.width : target.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error('Браузер не поддерживает подготовку изображения для OCR');
  }
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(bitmap, -target.width / 2, -target.height / 2, target.width, target.height);
  bitmap.close();

  if (monochrome) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const gray = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
      const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
      pixels.data[index] = contrasted;
      pixels.data[index + 1] = contrasted;
      pixels.data[index + 2] = contrasted;
    }
    context.putImageData(pixels, 0, 0);
  }
  return canvas;
}

function paddleResultText(result) {
  return (result?.items || [])
    .filter((item) => String(item.text || '').trim())
    .map((item) => String(item.text).trim())
    .join('\n');
}

function paddleResultConfidence(result) {
  const scores = (result?.items || []).map((item) => Number(item.score)).filter(Number.isFinite);
  return scores.length ? (scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100 : 0;
}

function receiptSignalScore(text, confidence) {
  const value = String(text || '');
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const uniqueRatio = lines.length ? new Set(lines.map((line) => line.toLocaleLowerCase('ru-RU'))).size / lines.length : 0;
  let score = Math.min(20, value.length / 20) + Math.min(15, Number(confidence) / 6);
  if (/\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}/u.test(value)) score += 25;
  if (/(?:итог|всего|жалпы|жиыны|барлығы|total)[^\d]{0,24}[\d ]{2,}/iu.test(value)) score += 25;
  if (/\d[\d ]*(?:[,.]\d{1,2})?\s*(?:₸|тг|тенге|KZT|[TТ]\b)/iu.test(value)) score += 10;
  if (uniqueRatio < 0.35) score -= 40;
  return score;
}

async function extractWithPaddle(file, onProgress) {
  const ocr = await getPaddleOcr(onProgress);
  let best = null;
  for (const rotation of [0, 90, 270, 180]) {
    onProgress?.({ stage: 'ocr', engine: 'paddle', status: rotation ? 'checking-orientation' : 'recognizing', rotation });
    const canvas = await imageCanvas(file, rotation, false);
    const [result] = await ocr.predict(canvas, {
      textDetLimitSideLen: 1600,
      textDetLimitType: 'max',
      textDetMaxSideLimit: 2400,
      textDetBoxThresh: 0.45,
      textRecScoreThresh: 0.25,
    });
    const text = paddleResultText(result);
    const confidence = paddleResultConfidence(result);
    const candidate = { text, confidence, score: receiptSignalScore(text, confidence) };
    if (!best || candidate.score > best.score) best = candidate;
    if (candidate.score >= 67) break;
  }
  if (!best?.text || best.text.replace(/\s/g, '').length < 20) {
    throw new Error('PP-OCRv5 не нашёл достаточно текста');
  }
  return { text: best.text, confidence: best.confidence, engine: 'paddle' };
}

async function extractWithTesseract(file, onProgress) {
  const worker = await getOcrWorker(onProgress);
  let best = null;
  const rotations = globalThis.createImageBitmap && globalThis.document ? [0, 90, 270, 180] : [0];
  for (const rotation of rotations) {
    let imageForOcr = file;
    if (globalThis.createImageBitmap && globalThis.document) {
      const canvas = await imageCanvas(file, rotation, true);
      imageForOcr = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png')) || file;
    }
    onProgress?.({
      stage: 'ocr',
      engine: 'tesseract',
      status: rotation ? 'checking-orientation' : 'recognizing',
      rotation,
    });
    const result = await worker.recognize(imageForOcr);
    const text = result.data.text || '';
    const confidence = Number(result.data.confidence) || 0;
    const candidate = { text, confidence, score: receiptSignalScore(text, confidence) };
    if (!best || candidate.score > best.score) best = candidate;
    if (hasCriticalReceiptSignals(text)) break;
  }
  return { text: best?.text || '', confidence: best?.confidence || 0, engine: 'tesseract' };
}

function hasCriticalReceiptSignals(text) {
  const value = String(text || '');
  const hasDate = /\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}/u.test(value);
  const hasTotal = /(?:итог|всего|жалпы|жиыны|барлығы|total)[^\d]{0,24}[\d ]{2,}/iu.test(value);
  return hasDate && hasTotal;
}

export async function prewarmDocumentOcr() {
  if (!globalThis.createImageBitmap || !globalThis.document) return false;
  await Promise.all([getPaddleOcr(), getOcrWorker()]);
  return true;
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
      onProgress?.({ stage: 'preparing', progress: 1 });
      try {
        const paddleResult = await extractWithPaddle(file, onProgress);
        if (hasCriticalReceiptSignals(paddleResult.text)) return paddleResult;
        onProgress?.({ stage: 'ocr', engine: 'tesseract', status: 'supplementing', progress: 0 });
        const tesseractResult = await extractWithTesseract(file, onProgress);
        return {
          text: `${paddleResult.text}\n${tesseractResult.text}`,
          confidence: Math.max(paddleResult.confidence, tesseractResult.confidence),
          engine: 'paddle+tesseract',
        };
      } catch (error) {
        if (['AbortError', 'OcrTimeoutError'].includes(error.name)) throw error;
        invalidatePaddleOcr();
        onProgress?.({ stage: 'ocr', engine: 'tesseract', status: 'fallback', progress: 0 });
        return extractWithTesseract(file, onProgress);
      }
    }, {
      signal,
      timeoutMs,
      onCancel: () => {
        invalidatePaddleOcr();
        invalidateOcrWorker();
      },
    });
  } catch (error) {
    if (!['AbortError', 'OcrTimeoutError'].includes(error.name)) {
      invalidatePaddleOcr();
      invalidateOcrWorker();
    }
    throw error;
  } finally {
    paddleProgressListener = null;
    ocrProgressListener = null;
  }
}

async function extractScannedPdf(file, onProgress, options) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  if (pdf.numPages > 5) throw new Error('Сканированный PDF длиннее 5 страниц. Разделите его на части для локального OCR.');
  const texts = [];
  let confidenceTotal = 0;
  let engine = null;
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
    engine = ocr.engine || engine;
  }
  return { text: texts.join('\n'), confidence: confidenceTotal / pdf.numPages, engine };
}

export async function extractDocument(file, onProgress, options = {}) {
  const buffer = await file.arrayBuffer();
  const documentHash = await sha256Hex(buffer);
  const binaryKind = detectBinaryKind(buffer);
  const type = file.type || '';
  const extension = file.name.split('.').pop()?.toLowerCase();
  let text = '';
  let ocrConfidence = null;
  let ocrEngine = null;
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
      ocrEngine = ocr.engine || null;
    }
  } else if ((type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp'].includes(extension)) && binaryKind === 'image') {
    const ocr = await extractImageText(file, onProgress, options);
    text = ocr.text;
    ocrConfidence = ocr.confidence;
    ocrEngine = ocr.engine || null;
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
    ocrEngine,
    parsed,
  };
}
