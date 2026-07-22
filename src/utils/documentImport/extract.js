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
const TOTAL_LABEL_PATTERN = /(?:ито(?:г|р|ю)|всего|жалпы|жиыны|барлығы|барлыны|total|оплаченн(?:ая|о)\s+сумма|сумма платежа)/iu;

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

function enhanceCanvas(canvas, contrast = 1.35) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const gray = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
    const contrasted = Math.max(0, Math.min(255, (gray - 128) * contrast + 128));
    pixels.data[index] = contrasted;
    pixels.data[index + 1] = contrasted;
    pixels.data[index + 2] = contrasted;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

async function imageCanvas(file, rotation = 0, monochrome = false) {
  const bitmap = await globalThis.createImageBitmap(file);
  const target = calculateOcrImageSize(bitmap.width, bitmap.height);
  const radians = (rotation * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = Math.ceil(target.width * cosine + target.height * sine);
  canvas.height = Math.ceil(target.width * sine + target.height * cosine);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error('Браузер не поддерживает подготовку изображения для OCR');
  }
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(radians);
  context.drawImage(bitmap, -target.width / 2, -target.height / 2, target.width, target.height);
  bitmap.close();

  return monochrome ? enhanceCanvas(canvas) : canvas;
}

function normalizedTextLineAngle(item) {
  const [left, right] = item?.poly || [];
  if (!left || !right) return null;
  let angle = Math.atan2(right[1] - left[1], right[0] - left[0]) * 180 / Math.PI;
  while (angle > 45) angle -= 90;
  while (angle < -45) angle += 90;
  return angle;
}

function detectedTextSkew(result) {
  const angles = (result?.items || [])
    .filter((item) => Number(item.score) >= 0.45 && String(item.text || '').trim().length >= 2)
    .map(normalizedTextLineAngle)
    .filter((angle) => Number.isFinite(angle) && Math.abs(angle) <= 15)
    .sort((a, b) => a - b);
  if (angles.length < 3) return 0;
  const middle = Math.floor(angles.length / 2);
  return angles.length % 2 ? angles[middle] : (angles[middle - 1] + angles[middle]) / 2;
}

function itemBounds(item) {
  const points = item?.poly || [];
  if (!points.length) return null;
  const xs = points.map((point) => Number(point[0])).filter(Number.isFinite);
  const ys = points.map((point) => Number(point[1])).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

function criticalReceiptCrop(canvas, result) {
  const labelled = (result?.items || [])
    .filter((item) => TOTAL_LABEL_PATTERN.test(String(item.text || '')))
    .map((item) => ({ item, bounds: itemBounds(item) }))
    .filter((entry) => entry.bounds)
    .sort((a, b) => b.bounds.top - a.bounds.top)[0];
  const top = labelled
    ? Math.max(0, labelled.bounds.top - Math.max(80, (labelled.bounds.bottom - labelled.bounds.top) * 4))
    : Math.round(canvas.height * 0.42);
  const bottom = labelled
    ? Math.min(canvas.height, labelled.bounds.bottom + Math.max(220, (labelled.bounds.bottom - labelled.bounds.top) * 10))
    : canvas.height;
  const sourceHeight = Math.max(1, bottom - top);
  const scale = Math.min(2.4, Math.max(1, 1800 / canvas.width));
  const focused = globalThis.document.createElement('canvas');
  focused.width = Math.max(1, Math.round(canvas.width * scale));
  focused.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = focused.getContext('2d', { willReadFrequently: true });
  context.drawImage(canvas, 0, top, canvas.width, sourceHeight, 0, 0, focused.width, focused.height);
  return enhanceCanvas(focused, 1.45);
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
  if (/(?:ито(?:г|р|ю)|всего|жалпы|жиыны|барлығы|total)[^\d]{0,24}[\d ]{2,}/iu.test(value)) score += 25;
  if (/\d[\d ]*(?:[,.]\d{1,2})?\s*(?:₸|тг|тенге|KZT|[TТ]\b)/iu.test(value)) score += 10;
  if (uniqueRatio < 0.35) score -= 40;
  return score;
}

async function extractWithPaddle(file, onProgress) {
  const ocr = await getPaddleOcr(onProgress);
  let best = null;
  const rotations = [0, 90, 270, 180];
  for (const [index, rotation] of rotations.entries()) {
    onProgress?.({
      stage: 'ocr',
      engine: 'paddle',
      status: rotation ? 'checking-orientation' : 'recognizing',
      rotation,
      pass: index + 1,
      passes: rotations.length,
    });
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
    const candidate = { text, confidence, score: receiptSignalScore(text, confidence), result, canvas, rotation };
    if (!best || candidate.score > best.score) best = candidate;
    if (candidate.score >= 67) break;
  }
  if (!best?.text || best.text.replace(/\s/g, '').length < 20) {
    throw new Error('PP-OCRv5 не нашёл достаточно текста');
  }
  const skew = detectedTextSkew(best.result);
  if (Math.abs(skew) >= 0.7) {
    onProgress?.({ stage: 'ocr', engine: 'paddle', status: 'deskewing', progress: 0 });
    const canvas = await imageCanvas(file, best.rotation - skew, false);
    const [result] = await ocr.predict(canvas, {
      textDetLimitSideLen: 1600,
      textDetLimitType: 'max',
      textDetMaxSideLimit: 2400,
      textDetBoxThresh: 0.4,
      textRecScoreThresh: 0.2,
    });
    const text = paddleResultText(result);
    const confidence = paddleResultConfidence(result);
    const corrected = { text, confidence, score: receiptSignalScore(text, confidence), result, canvas, rotation: best.rotation - skew };
    if (corrected.score >= best.score - 3) best = corrected;
  }

  onProgress?.({ stage: 'ocr', engine: 'paddle', status: 'recognizing-total', progress: 0 });
  const focusedCanvas = criticalReceiptCrop(best.canvas, best.result);
  const [focusedResult] = await ocr.predict(focusedCanvas, {
    textDetLimitSideLen: 1800,
    textDetLimitType: 'max',
    textDetMaxSideLimit: 2400,
    textDetBoxThresh: 0.32,
    textRecScoreThresh: 0.18,
  });
  const criticalText = paddleResultText(focusedResult);
  return {
    text: best.text,
    criticalText,
    confidence: Math.max(best.confidence, paddleResultConfidence(focusedResult)),
    engine: 'paddle',
  };
}

async function extractWithTesseract(file, onProgress) {
  const worker = await getOcrWorker(onProgress);
  let best = null;
  const rotations = globalThis.createImageBitmap && globalThis.document ? [0, 90, 270, 180] : [0];
  for (const [index, rotation] of rotations.entries()) {
    const pass = index + 1;
    ocrProgressListener = (progress) => onProgress?.({
      ...progress,
      engine: 'tesseract',
      rotation,
      pass,
      passes: rotations.length,
    });
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
      progress: 0,
      pass,
      passes: rotations.length,
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
  const hasTotal = /(?:ито(?:г|р|ю)|всего|жалпы|жиыны|барлығы|total)[^\d]{0,24}[\d ]{2,}/iu.test(value);
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
  const reportPaddleProgress = (progress) => {
    const pass = Math.max(1, Number(progress.pass) || 1);
    const passes = Math.max(pass, Number(progress.passes) || 4);
    const completedPasses = Math.min(passes, pass - 1);
    const overallProgress = progress.status === 'loading-model'
      ? 0.03
      : progress.status === 'deskewing'
        ? 0.38
        : progress.status === 'recognizing-total'
          ? 0.44
          : 0.06 + (completedPasses / passes) * 0.3;
    onProgress?.({ ...progress, overallProgress });
  };
  const reportTesseractProgress = (progress) => {
    const pass = Math.max(1, Number(progress.pass) || 1);
    const passes = Math.max(pass, Number(progress.passes) || 4);
    const passProgress = Math.max(0, Math.min(1, Number(progress.progress) || 0));
    const completedPasses = Math.min(passes, pass - 1);
    const overallProgress = progress.pass
      ? 0.48 + ((completedPasses + passProgress) / passes) * 0.48
      : 0.43 + passProgress * 0.05;
    onProgress?.({ ...progress, overallProgress });
  };
  try {
    const result = await runWithOcrDeadline(async () => {
      onProgress?.({ stage: 'preparing', progress: 0, overallProgress: 0 });
      onProgress?.({ stage: 'preparing', progress: 1, overallProgress: 0.02 });
      try {
        const paddleResult = await extractWithPaddle(file, reportPaddleProgress);
        const paddleText = `${paddleResult.text}\n${paddleResult.criticalText || ''}`;
        if (hasCriticalReceiptSignals(paddleText)) return { ...paddleResult, text: paddleText, primaryText: paddleResult.text };
        reportTesseractProgress({ stage: 'ocr', engine: 'tesseract', status: 'supplementing', progress: 0 });
        const tesseractResult = await extractWithTesseract(file, reportTesseractProgress);
        return {
          text: `${paddleResult.text}\n${paddleResult.criticalText || ''}\n${tesseractResult.text}`,
          primaryText: `${paddleResult.text}\n${tesseractResult.text}`,
          criticalText: paddleResult.criticalText || '',
          confidence: Math.max(paddleResult.confidence, tesseractResult.confidence),
          engine: 'paddle+tesseract',
        };
      } catch (error) {
        if (['AbortError', 'OcrTimeoutError'].includes(error.name)) throw error;
        invalidatePaddleOcr();
        reportTesseractProgress({ stage: 'ocr', engine: 'tesseract', status: 'fallback', progress: 0 });
        const fallback = await extractWithTesseract(file, reportTesseractProgress);
        return { ...fallback, primaryText: fallback.text, criticalText: '' };
      }
    }, {
      signal,
      timeoutMs,
      onCancel: () => {
        invalidatePaddleOcr();
        invalidateOcrWorker();
      },
    });
    onProgress?.({ stage: 'finalizing', overallProgress: 0.99 });
    return result;
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
  const criticalTexts = [];
  const primaryTexts = [];
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
    primaryTexts.push(ocr.primaryText || ocr.text);
    if (ocr.criticalText) criticalTexts.push(ocr.criticalText);
    confidenceTotal += ocr.confidence;
    engine = ocr.engine || engine;
  }
  return {
    text: texts.join('\n'),
    primaryText: primaryTexts.join('\n'),
    criticalText: criticalTexts.join('\n'),
    confidence: confidenceTotal / pdf.numPages,
    engine,
  };
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
  let ocrCriticalText = null;
  let ocrPrimaryText = null;
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
      ocrCriticalText = ocr.criticalText || '';
      ocrPrimaryText = ocr.primaryText || ocr.text;
    }
  } else if ((type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp'].includes(extension)) && binaryKind === 'image') {
    const ocr = await extractImageText(file, onProgress, options);
    text = ocr.text;
    ocrConfidence = ocr.confidence;
    ocrEngine = ocr.engine || null;
    ocrCriticalText = ocr.criticalText || '';
    ocrPrimaryText = ocr.primaryText || ocr.text;
  } else {
    throw new Error('Содержимое файла не соответствует PDF, JPG, PNG, WEBP или CSV. Расширение файла не считается достаточной проверкой.');
  }
  const parsed = sourceKind === 'csv'
    ? null
    : await parseBankDocumentText(
      text,
      ocrConfidence !== null ? 'image' : sourceKind,
      ocrConfidence !== null ? { criticalText: ocrCriticalText || '', primaryText: ocrPrimaryText || '' } : {},
    );
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
