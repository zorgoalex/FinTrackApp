#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parseBankDocumentText } from '../src/utils/documentImport/parsers.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const projectRoot = path.resolve(repoRoot, '..', '..');

const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['merchant', 'date', 'total', 'currency', 'line_items', 'discount_total', 'confidence'],
  properties: {
    merchant: { type: ['string', 'null'] },
    date: { type: ['string', 'null'], description: 'Purchase date in YYYY-MM-DD format' },
    total: { type: ['number', 'null'] },
    currency: { type: ['string', 'null'], enum: ['KZT', 'USD', 'EUR', 'RUB', null] },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'quantity', 'unit_price', 'amount'],
        properties: {
          description: { type: 'string' },
          quantity: { type: ['number', 'null'] },
          unit_price: { type: ['number', 'null'] },
          amount: { type: ['number', 'null'] },
        },
      },
    },
    discount_total: { type: ['number', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

const OCR_PROMPT = [
  'Extract all readable content from this receipt in natural reading order.',
  'Return one Markdown document and preserve the original text without translation.',
  'Do not infer or invent content that is not visible.',
].join(' ');

const STRUCTURED_PROMPT = [
  'Read this receipt and extract only the purchase data described by the JSON schema.',
  'The total is the final amount paid, not cash received, change, tax, subtotal, fiscal number, or card balance.',
  'Keep product and merchant names in the original language.',
  'Exclude fiscal identifiers, personal names, phone numbers, addresses, QR data, card numbers, account numbers, and loyalty identifiers.',
  'Use null when a value is not visible. Never guess a missing amount or date.',
].join(' ');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
    const value = inlineValue ?? (argv[index + 1]?.startsWith('--') ? true : argv[++index]);
    result[rawKey] = value;
  }
  return result;
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/(?:тоо|ип|жшс|ао|llp|ltd|казахстан)/giu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function merchantMatches(expected, actual) {
  if (expected == null) return null;
  const left = normalizeText(expected);
  const right = normalizeText(actual);
  if (!left || !right) return false;
  if (left.includes(right) || right.includes(left)) return true;
  const leftTokens = new Set(left.split(' ').filter((token) => token.length > 2));
  const rightTokens = new Set(right.split(' ').filter((token) => token.length > 2));
  if (!leftTokens.size || !rightTokens.size) return false;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / Math.min(leftTokens.size, rightTokens.size) >= 0.5;
}

function inferMerchant(text) {
  const ignored = /^(?:продажа|покупка|кассир|смена|чек|гостевой счет|фискаль|дата|время|итог|сумма|заказ|тапсырыс|номер заказа|стол|зал|alexey|инн|бин|жсн|бсн|рнм|знм|мзн|офд|http)/iu;
  const candidates = String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[#>*\s-]+|[*\s-]+$/g, '').replace(/\s+/g, ' ').trim())
    .filter((line) => line && line.length >= 3 && line.length <= 100)
    .filter((line) => /\p{L}{3}/u.test(line) && !ignored.test(line))
    .filter((line) => !/\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4,}|consumer|спасибо|рахмет/iu.test(line));
  return candidates[0] || null;
}

function countReceiptItems(comment) {
  return (String(comment || '').match(/^•\s+/gmu) || []).length;
}

async function structureLocalOcr(text) {
  const parsed = await parseBankDocumentText(text, 'image');
  const operation = parsed.operations[0] || {};
  return {
    merchant: inferMerchant(text),
    date: operation.operation_date || null,
    total: Number.isFinite(Number(operation.amount)) ? Number(operation.amount) : null,
    currency: operation.currency || null,
    line_items: Array.from({ length: countReceiptItems(operation.receipt_items_comment) }, () => ({})),
    discount_total: null,
    confidence: Number(operation.confidence) || 0,
  };
}

function parseJsonContent(content) {
  const value = String(content || '').trim();
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1];
  const candidate = fenced || value.slice(value.indexOf('{'), value.lastIndexOf('}') + 1);
  if (!candidate) throw new Error('Provider returned no JSON object');
  return JSON.parse(candidate);
}

async function loadEnvFile(filename) {
  try {
    const text = await readFile(filename, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      if (process.env[key]) continue;
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function postJson(url, body, headers = {}, timeoutMs = 180_000) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: globalThis.AbortSignal.timeout(timeoutMs),
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${responseText.slice(0, 500)}`);
  return JSON.parse(responseText);
}

async function imageDataUrl(filename) {
  const extension = path.extname(filename).toLowerCase();
  const mime = extension === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${(await readFile(filename)).toString('base64')}`;
}

class OvisProvider {
  constructor(options) {
    this.options = options;
    this.child = null;
    this.logs = [];
  }

  async start() {
    const { executable, model, mmproj, port, threads, device, gpuLayers } = this.options;
    const runtimeArgs = [
      '-m', model,
      '--mmproj', mmproj,
      '--host', '127.0.0.1',
      '--port', String(port),
      '--device', device,
      '-ngl', String(gpuLayers),
      '-t', String(threads),
      '-tb', String(threads),
      '-c', '8192',
      '-np', '1',
    ];
    if (device === 'none') runtimeArgs.push('--no-mmproj-offload');
    this.child = spawn(executable, runtimeArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const remember = (chunk) => {
      this.logs.push(chunk.toString());
      if (this.logs.length > 80) this.logs.shift();
    };
    this.child.stdout.on('data', remember);
    this.child.stderr.on('data', remember);

    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (this.child.exitCode !== null) throw new Error(`Ovis server exited early: ${this.logs.join('').slice(-2000)}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: globalThis.AbortSignal.timeout(1500) });
        if (response.ok) return;
      } catch {
        // The local server is still starting; retry until the bounded deadline.
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Ovis server did not become healthy: ${this.logs.join('').slice(-2000)}`);
  }

  async recognize(filename) {
    const startedAt = globalThis.performance.now();
    const data = await postJson(`http://127.0.0.1:${this.options.port}/v1/chat/completions`, {
      model: 'OvisOCR2',
      temperature: 0,
      max_tokens: this.options.maxTokens,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: OCR_PROMPT },
          { type: 'image_url', image_url: { url: await imageDataUrl(filename) } },
        ],
      }],
    }, {}, this.options.timeoutMs);
    const raw = data.choices?.[0]?.message?.content || '';
    return {
      raw,
      structured: await structureLocalOcr(raw),
      latency_ms: Math.round(globalThis.performance.now() - startedAt),
      usage: data.usage || null,
    };
  }

  async stop() {
    if (!this.child || this.child.exitCode !== null) return;
    this.child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => this.child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (this.child.exitCode === null) this.child.kill('SIGKILL');
  }
}

class OpenRouterProvider {
  constructor(options) {
    this.options = options;
    this.apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!this.apiKey) throw new Error('OPENROUTER_API_KEY is missing');
  }

  async start() {}

  async recognize(filename) {
    const startedAt = globalThis.performance.now();
    const data = await postJson('https://openrouter.ai/api/v1/chat/completions', {
      model: this.options.model,
      temperature: 0,
      max_tokens: 1200,
      provider: { data_collection: 'deny', allow_fallbacks: false },
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'receipt_extraction', strict: true, schema: RECEIPT_SCHEMA },
      },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: STRUCTURED_PROMPT },
          { type: 'image_url', image_url: { url: await imageDataUrl(filename) } },
        ],
      }],
    }, {
      Authorization: `Bearer ${this.apiKey}`,
      'HTTP-Referer': 'https://fintrackapp-wheat.vercel.app',
      'X-Title': 'FinTrackApp receipt benchmark',
    });
    const raw = data.choices?.[0]?.message?.content || '';
    return {
      raw,
      structured: parseJsonContent(raw),
      latency_ms: Math.round(globalThis.performance.now() - startedAt),
      usage: data.usage || null,
    };
  }

  async stop() {}
}

function scoreDocument(expected, actual, complete) {
  const checks = {
    merchant: merchantMatches(expected.merchant, actual.merchant),
    date: expected.date == null ? null : expected.date === actual.date,
    total: expected.total == null ? null : Math.abs(expected.total - Number(actual.total)) < 0.005,
    currency: expected.currency == null ? null : expected.currency === actual.currency,
    line_item_count: expected.line_item_count == null ? null : expected.line_item_count === (actual.line_items?.length ?? null),
  };
  const critical = ['date', 'total', 'currency'].filter((key) => checks[key] !== null);
  return {
    checks,
    critical_exact: complete && critical.every((key) => checks[key] === true),
  };
}

function summarize(results) {
  const fields = ['merchant', 'date', 'total', 'currency', 'line_item_count'];
  const field_accuracy = Object.fromEntries(fields.map((field) => {
    const scored = results.map((row) => row.score.checks[field]).filter((value) => value !== null);
    const correct = scored.filter(Boolean).length;
    return [field, { correct, total: scored.length, accuracy: scored.length ? correct / scored.length : null }];
  }));
  const complete = results.filter((row) => row.complete);
  const latencies = results.map((row) => row.latency_ms).sort((a, b) => a - b);
  const percentile = (fraction) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * fraction))] || null;
  const duplicateGroups = Object.values(Object.groupBy(results, (row) => row.document_group)).filter((rows) => rows.length > 1);
  return {
    documents: results.length,
    complete_documents: complete.length,
    critical_exact: complete.filter((row) => row.score.critical_exact).length,
    critical_exact_rate: complete.length ? complete.filter((row) => row.score.critical_exact).length / complete.length : null,
    field_accuracy,
    latency_ms: { p50: percentile(0.5), p95: percentile(0.95), max: latencies.at(-1) || null },
    duplicate_groups: duplicateGroups.map((rows) => ({
      group: rows[0].document_group,
      ids: rows.map((row) => row.id),
      consistent: new Set(rows.map((row) => JSON.stringify({
        date: row.actual.date,
        total: row.actual.total,
        currency: row.actual.currency,
      }))).size === 1,
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const providerName = String(args.provider || 'ovis');
  const datasetDir = path.resolve(args.dataset || path.join(projectRoot, 'artifacts', 'import_test', 'receipts'));
  const truthPath = path.resolve(args.truth || path.join(datasetDir, 'ground-truth.json'));
  const outputDir = path.resolve(args.output || path.join(projectRoot, 'artifacts', 'ocr_benchmark', providerName));
  await loadEnvFile(path.join(repoRoot, '.env.local'));
  const truth = JSON.parse(await readFile(truthPath, 'utf8'));
  const selectedIds = args.ids ? new Set(String(args.ids).split(',').map((value) => value.trim()).filter(Boolean)) : null;
  const limit = args.limit ? Number(args.limit) : Infinity;
  const documents = truth.documents.filter((row) => !selectedIds || selectedIds.has(row.id)).slice(0, limit);
  if (!documents.length) throw new Error('No benchmark documents selected');
  await mkdir(path.join(outputDir, 'raw'), { recursive: true });

  let provider;
  if (providerName === 'ovis') {
    provider = new OvisProvider({
      executable: path.resolve(args.executable || path.join(projectRoot, 'artifacts', 'runtime', 'llama-b10076-cpu', 'llama-server.exe')),
      model: path.resolve(args.model || path.join(projectRoot, 'artifacts', 'model_cache', 'ovisocr2', 'OvisOCR2-Q5_K_M.gguf')),
      mmproj: path.resolve(args.mmproj || path.join(projectRoot, 'artifacts', 'model_cache', 'ovisocr2', 'mmproj-F16.gguf')),
      port: Number(args.port || 18083),
      threads: Number(args.threads || Math.min(12, Math.max(1, Number(process.env.NUMBER_OF_PROCESSORS) || 4))),
      maxTokens: Number(args['max-tokens'] || 1800),
      timeoutMs: Number(args['timeout-ms'] || 120_000),
      device: String(args.device || 'none'),
      gpuLayers: Number(args['gpu-layers'] || 0),
    });
  } else if (providerName === 'openrouter') {
    provider = new OpenRouterProvider({ model: String(args.model || process.env.OPENROUTER_RECEIPT_MODEL || 'google/gemini-3-flash-preview') });
  } else {
    throw new Error(`Unknown provider: ${providerName}`);
  }

  const results = [];
  await provider.start();
  try {
    for (const [index, document] of documents.entries()) {
      process.stdout.write(`[${index + 1}/${documents.length}] ${document.id} ... `);
      const filename = path.join(datasetDir, document.file);
      try {
        const recognized = await provider.recognize(filename);
        const extension = providerName === 'ovis' ? 'md' : 'json';
        await writeFile(path.join(outputDir, 'raw', `${document.id}.${extension}`), `${recognized.raw}\n`, 'utf8');
        const row = {
          id: document.id,
          file: document.file,
          document_group: document.document_group,
          complete: document.complete,
          expected: document.expected,
          actual: recognized.structured,
          score: scoreDocument(document.expected, recognized.structured, document.complete),
          latency_ms: recognized.latency_ms,
          usage: recognized.usage,
        };
        results.push(row);
        console.log(`${row.score.critical_exact ? 'critical OK' : 'review'} (${row.latency_ms} ms)`);
      } catch (error) {
        results.push({
          id: document.id,
          file: document.file,
          document_group: document.document_group,
          complete: document.complete,
          expected: document.expected,
          actual: {},
          score: scoreDocument(document.expected, {}, document.complete),
          latency_ms: null,
          error: error.message,
        });
        console.log(`ERROR: ${error.message}`);
      }
    }
  } finally {
    await provider.stop();
  }

  const report = {
    generated_at: new Date().toISOString(),
    provider: providerName,
    model: provider.options?.model || null,
    dataset: path.basename(datasetDir),
    summary: summarize(results.filter((row) => row.latency_ms !== null)),
    results,
  };
  await writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Report: ${path.join(outputDir, 'report.json')}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
