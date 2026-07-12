import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const workspaceRoot = resolve(import.meta.dirname, '..', '..', '..');
const outputDir = resolve(workspaceRoot, 'artifacts', 'tts_benchmark_scenarios');
const sourcePath = resolve(workspaceRoot, 'artifacts', 'voice_benchmark_scenarios', 'labels', 'all_scenarios.csv');
const providers = ['openai', 'elevenlabs', 'cartesia', 'hume', 'azure', 'yandex', 'google', 'aws_polly'];

function parseCsvLine(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === ';' && !quoted) {
      fields.push(value);
      value = '';
    } else value += char;
  }
  fields.push(value);
  return fields;
}

function countBy(items, key) {
  return Object.fromEntries([...items.reduce((map, item) => map.set(item[key], (map.get(item[key]) ?? 0) + 1), new Map())].sort());
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const jobs = (await readFile(resolve(outputDir, 'all_tts_scenarios.jsonl'), 'utf8'))
  .trim().split(/\r?\n/).map(JSON.parse);
const rawSource = (await readFile(sourcePath, 'utf8')).replace(/^\uFEFF/, '').trim().split(/\r?\n/);
const columns = parseCsvLine(rawSource[0]);
const sources = rawSource.slice(1).map((line) => Object.fromEntries(columns.map((column, index) => [column, parseCsvLine(line)[index] ?? ''])));
const sourceById = new Map(sources.map((source) => [source.id, source]));

assert(jobs.length === 1000, `Expected 1000 jobs, got ${jobs.length}`);
assert(new Set(jobs.map((job) => job.id)).size === 1000, 'TTS job IDs are not unique');
assert(new Set(jobs.map((job) => job.source_scenario_id)).size === 1000, 'Source scenario IDs are not unique');

for (let part = 1; part <= 10; part += 1) {
  const filename = `tts_scenarios_${String(part).padStart(2, '0')}.jsonl`;
  const rows = (await readFile(resolve(outputDir, 'parts', filename), 'utf8')).trim().split(/\r?\n/);
  assert(rows.length === 100, `${filename}: expected 100 rows, got ${rows.length}`);
}

for (const job of jobs) {
  const source = sourceById.get(job.source_scenario_id);
  assert(source, `${job.id}: missing source scenario`);
  const noSpeech = job.expected.intent === 'no_speech';
  assert(job.render_text === (noSpeech ? '' : source.target_spoken_text), `${job.id}: render_text differs from source`);
  assert(providers.every((provider) => provider in job.provider_requests), `${job.id}: missing provider request`);
  assert(providers.every((provider) => Boolean(job.provider_requests[provider].skip_tts) === noSpeech), `${job.id}: inconsistent skip_tts`);
}

const speakerCounts = countBy(jobs, 'speaker_profile_id');
const environmentCounts = countBy(jobs, 'environment_profile_id');
assert(Object.keys(speakerCounts).length === 40 && Object.values(speakerCounts).every((count) => count === 25), 'Speaker distribution must be 40 x 25');
assert(Object.keys(environmentCounts).length === 20 && Object.values(environmentCounts).every((count) => count === 50), 'Environment distribution must be 20 x 50');

console.log(JSON.stringify({
  valid: true,
  total: jobs.length,
  parts: 10,
  rows_per_part: 100,
  unique_job_ids: 1000,
  exact_source_text_matches: 1000,
  speakers: speakerCounts,
  environments: environmentCounts,
  devices: countBy(jobs, 'device_profile_id'),
  modes: countBy(jobs, 'source_mode'),
  no_speech: jobs.filter((job) => job.expected.intent === 'no_speech').length,
}, null, 2));
