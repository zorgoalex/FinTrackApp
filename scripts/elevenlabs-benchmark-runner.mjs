import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const workspaceRoot = resolve(repoRoot, '..', '..');
const datasetDir = resolve(workspaceRoot, 'artifacts', 'tts_benchmark_scenarios');
const runDir = resolve(datasetDir, 'elevenlabs_run');
const apiBase = 'https://api.elevenlabs.io';

function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return { command, options };
}

async function requireApiKey() {
  const environmentKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (environmentKey) return environmentKey;
  const keyFile = process.env.ELEVENLABS_API_KEY_FILE
    ? resolve(process.env.ELEVENLABS_API_KEY_FILE)
    : resolve(workspaceRoot, '.secrets', 'elevenlabs-api-key.txt');
  if (existsSync(keyFile)) {
    const fileKey = (await readFile(keyFile, 'utf8')).trim();
    if (fileKey) return fileKey;
  }
  throw new Error(`ElevenLabs API key not found. Set ELEVENLABS_API_KEY or put it in ${keyFile}`);
}

function requireBillableConfirmation(options) {
  if (!options['confirm-billable']) {
    throw new Error('This command calls a billable API. Review the plan, then repeat it with --confirm-billable.');
  }
}

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function apiRequest(path, { method = 'GET', body, binary = false, retries = 4 } = {}) {
  const apiKey = await requireApiKey();
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        'xi-api-key': apiKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.ok) {
      return {
        data: binary ? Buffer.from(await response.arrayBuffer()) : await response.json(),
        requestId: response.headers.get('request-id') ?? response.headers.get('x-request-id'),
        characterCost: response.headers.get('character-cost'),
      };
    }
    const message = await response.text();
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000 * (2 ** attempt));
      continue;
    }
    throw new Error(`${method} ${path} failed with ${response.status}: ${message}`);
  }
  throw new Error(`Request retries exhausted for ${method} ${path}`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

async function loadJobs() {
  return (await readFile(resolve(datasetDir, 'all_tts_scenarios.jsonl'), 'utf8'))
    .trim().split(/\r?\n/).map(JSON.parse);
}

function extensionFor(format) {
  if (format.startsWith('mp3_')) return '.mp3';
  if (format.startsWith('wav_')) return '.wav';
  if (format.startsWith('pcm_')) return '.pcm';
  if (format.startsWith('opus_')) return '.opus';
  return '.audio';
}

async function checkAccount() {
  const [subscription, models, voices] = await Promise.all([
    apiRequest('/v1/user/subscription'),
    apiRequest('/v1/models'),
    apiRequest('/v2/voices?page_size=100'),
  ]);
  const ttsModels = models.data.filter((model) => model.can_do_text_to_speech);
  console.log(JSON.stringify({
    subscription: {
      tier: subscription.data.tier,
      character_count: subscription.data.character_count,
      character_limit: subscription.data.character_limit,
      voice_slots_used: subscription.data.voice_slots_used,
      voice_limit: subscription.data.voice_limit,
      status: subscription.data.status,
    },
    tts_models: ttsModels.map((model) => model.model_id),
    voices_returned: voices.data.voices?.length ?? 0,
  }, null, 2));
}

async function estimate() {
  const jobs = await loadJobs();
  const ambience = await readJson(resolve(datasetDir, 'ambience_assets.json'));
  const speechCharacters = jobs.reduce((total, job) => total + (job.provider_requests.elevenlabs.text?.length ?? 0), 0);
  const cleanSpeechCharacters = jobs.reduce((total, job) => total + job.render_text.length, 0);
  const effectPromptCharacters = ambience.reduce((total, asset) => total + (asset.elevenlabs_request?.text?.length ?? 0), 0);
  console.log(JSON.stringify({
    speech_jobs: jobs.filter((job) => !job.provider_requests.elevenlabs.skip_tts).length,
    clean_speech_characters: cleanSpeechCharacters,
    submitted_tts_characters_including_tags: speechCharacters,
    voice_design_profiles: 40,
    ambience_assets: ambience.filter((asset) => asset.elevenlabs_request).length,
    sound_effect_prompt_characters: effectPromptCharacters,
    note: 'Billing units can differ by model and plan. Confirm the current ElevenLabs pricing page and account subscription before running.',
  }, null, 2));
}

async function designVoices(options) {
  requireBillableConfirmation(options);
  const profiles = await readJson(resolve(datasetDir, 'speaker_profiles.json'));
  const selected = options.all
    ? profiles
    : profiles.filter((profile) => profile.id === options.profile);
  if (selected.length === 0) throw new Error('Use --profile TTS-SPK-001 or --all. Start with one profile.');
  const previewText = 'Вчера я заплатил две тысячи четыреста пятьдесят тенге за продукты, а сегодня перевёл пятнадцать тысяч со счёта Halyk Bonus на Kaspi Gold. Проверь дату, сумму и категорию операции.';
  for (const profile of selected) {
    const targetDir = resolve(runDir, 'voice_previews', profile.id);
    await mkdir(targetDir, { recursive: true });
    const request = {
      voice_description: profile.elevenlabs_voice_design.voice_description,
      model_id: profile.elevenlabs_voice_design.model_id ?? 'eleven_ttv_v3',
      text: previewText,
      auto_generate_text: false,
      loudness: profile.elevenlabs_voice_design.loudness,
      seed: profile.elevenlabs_voice_design.seed,
      guidance_scale: profile.elevenlabs_voice_design.guidance_scale,
      quality: profile.elevenlabs_voice_design.quality,
      should_enhance: false,
    };
    const result = await apiRequest('/v1/text-to-voice/design?output_format=mp3_44100_128', { method: 'POST', body: request });
    const manifest = { profile_id: profile.id, request, previews: [] };
    for (let index = 0; index < result.data.previews.length; index += 1) {
      const preview = result.data.previews[index];
      const filename = `${String(index + 1).padStart(2, '0')}_${preview.generated_voice_id}.mp3`;
      await writeFile(resolve(targetDir, filename), Buffer.from(preview.audio_base_64, 'base64'));
      manifest.previews.push({
        generated_voice_id: preview.generated_voice_id,
        filename,
        duration_secs: preview.duration_secs,
        language: preview.language,
      });
    }
    await writeJsonAtomic(resolve(targetDir, 'manifest.json'), manifest);
    console.log(`${profile.id}: saved ${manifest.previews.length} previews to ${targetDir}`);
    await sleep(350);
  }
}

async function createVoice(options) {
  requireBillableConfirmation(options);
  if (!options.profile || !options['generated-id']) {
    throw new Error('Required: --profile TTS-SPK-001 --generated-id <chosen_generated_voice_id>');
  }
  const profiles = await readJson(resolve(datasetDir, 'speaker_profiles.json'));
  const profile = profiles.find((item) => item.id === options.profile);
  if (!profile) throw new Error(`Unknown speaker profile: ${options.profile}`);
  const result = await apiRequest('/v1/text-to-voice', {
    method: 'POST',
    body: {
      voice_name: `FinTrack ${profile.id}`,
      voice_description: profile.voice_design_description,
      generated_voice_id: options['generated-id'],
      labels: {
        dataset: 'fintrack-stt-benchmark',
        profile_id: profile.id,
        language: 'ru',
        accent: profile.accent_id,
      },
    },
  });
  const mapPath = resolve(runDir, 'voice-map.json');
  const voiceMap = existsSync(mapPath) ? await readJson(mapPath) : {};
  voiceMap[profile.id] = {
    voice_id: result.data.voice_id,
    name: result.data.name,
    generated_voice_id: options['generated-id'],
    accepted_at: new Date().toISOString(),
  };
  await writeJsonAtomic(mapPath, voiceMap);
  console.log(`${profile.id} -> ${result.data.voice_id}`);
}

async function renderSpeech(options) {
  requireBillableConfirmation(options);
  const voiceMapPath = resolve(runDir, 'voice-map.json');
  if (!existsSync(voiceMapPath)) throw new Error('voice-map.json is missing. Design, review, and create at least one voice first.');
  const voiceMap = await readJson(voiceMapPath);
  let jobs = (await loadJobs()).filter((job) => !job.provider_requests.elevenlabs.skip_tts);
  if (options.speaker) jobs = jobs.filter((job) => job.speaker_profile_id === options.speaker);
  if (options.part) {
    const part = Number(options.part);
    jobs = jobs.filter((job) => Number(job.id.slice(4)) > (part - 1) * 100 && Number(job.id.slice(4)) <= part * 100);
  }
  if (options.start) jobs = jobs.slice(Number(options.start) - 1);
  if (options.limit) jobs = jobs.slice(0, Number(options.limit));
  if (jobs.length === 0) throw new Error('No speech jobs matched the supplied filters.');
  const format = String(options.format ?? 'mp3_44100_128');
  const audioDir = resolve(runDir, 'speech', format);
  const manifestPath = resolve(runDir, 'speech-manifest.jsonl');
  await mkdir(audioDir, { recursive: true });
  for (const job of jobs) {
    const mapped = voiceMap[job.speaker_profile_id];
    if (!mapped?.voice_id) throw new Error(`${job.id}: no accepted ElevenLabs voice for ${job.speaker_profile_id}`);
    const outputPath = resolve(audioDir, `${job.id}${extensionFor(format)}`);
    if (existsSync(outputPath) && !options.force) {
      console.log(`${job.id}: already exists, skipped`);
      continue;
    }
    const source = job.provider_requests.elevenlabs;
    const body = {
      text: source.text,
      model_id: source.model_id,
      language_code: source.language_code,
      voice_settings: source.voice_settings,
      seed: source.seed,
      apply_text_normalization: source.apply_text_normalization,
    };
    const result = await apiRequest(`/v1/text-to-speech/${mapped.voice_id}?output_format=${encodeURIComponent(format)}`, {
      method: 'POST', body, binary: true,
    });
    await writeFile(outputPath, result.data);
    await appendFile(manifestPath, `${JSON.stringify({
      job_id: job.id,
      speaker_profile_id: job.speaker_profile_id,
      voice_id: mapped.voice_id,
      model_id: body.model_id,
      seed: body.seed,
      output_format: format,
      file: outputPath,
      bytes: result.data.length,
      request_id: result.requestId,
      character_cost: result.characterCost,
      created_at: new Date().toISOString(),
    })}\n`, 'utf8');
    console.log(`${job.id}: ${result.data.length} bytes`);
    await sleep(Number(options.delay ?? 300));
  }
}

async function renderAmbience(options) {
  requireBillableConfirmation(options);
  let assets = (await readJson(resolve(datasetDir, 'ambience_assets.json')))
    .filter((asset) => asset.elevenlabs_request);
  if (options.id) assets = assets.filter((asset) => asset.id === options.id);
  if (options.limit) assets = assets.slice(0, Number(options.limit));
  const targetDir = resolve(runDir, 'ambience');
  await mkdir(targetDir, { recursive: true });
  for (const asset of assets) {
    const outputPath = resolve(targetDir, `${asset.id}.mp3`);
    if (existsSync(outputPath) && !options.force) {
      console.log(`${asset.id}: already exists, skipped`);
      continue;
    }
    const request = asset.elevenlabs_request;
    const result = await apiRequest('/v1/sound-generation', {
      method: 'POST',
      body: {
        text: request.text,
        duration_seconds: request.duration_seconds,
        prompt_influence: request.prompt_influence,
        loop: request.loop,
        model_id: request.model_id,
      },
      binary: true,
    });
    await writeFile(outputPath, result.data);
    console.log(`${asset.id}: ${result.data.length} bytes`);
    await sleep(Number(options.delay ?? 500));
  }
}

function printHelp() {
  console.log(`ElevenLabs benchmark runner

Read D:/Project/FinTrackingApp_v1/artifacts/tts_benchmark_scenarios/ELEVENLABS_RUNBOOK.md before billable commands.

Commands:
  estimate
  check
  design-voices --profile TTS-SPK-001 --confirm-billable
  design-voices --all --confirm-billable
  create-voice --profile TTS-SPK-001 --generated-id <id> --confirm-billable
  render-speech --speaker TTS-SPK-001 --limit 20 --confirm-billable
  render-speech --part 1 --format mp3_44100_128 --confirm-billable
  render-ambience --limit 2 --confirm-billable

All commands are resumable: existing audio files are skipped unless --force is supplied.`);
}

const { command, options } = parseArgs(process.argv.slice(2));
try {
  if (command === 'estimate') await estimate();
  else if (command === 'check') await checkAccount();
  else if (command === 'design-voices') await designVoices(options);
  else if (command === 'create-voice') await createVoice(options);
  else if (command === 'render-speech') await renderSpeech(options);
  else if (command === 'render-ambience') await renderAmbience(options);
  else printHelp();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
