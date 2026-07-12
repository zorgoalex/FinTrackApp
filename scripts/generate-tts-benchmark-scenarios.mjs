import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const workspaceRoot = resolve(repoRoot, '..', '..');
const sourceCsv = resolve(workspaceRoot, 'artifacts', 'voice_benchmark_scenarios', 'labels', 'all_scenarios.csv');
const outputDir = resolve(workspaceRoot, 'artifacts', 'tts_benchmark_scenarios');
const partsDir = resolve(outputDir, 'parts');

function mulberry32(seed) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20260713);
const pick = (items) => items[Math.floor(random() * items.length)];
const round = (value, digits = 2) => Number(value.toFixed(digits));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function parseCsvLine(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ';' && !quoted) {
      fields.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  fields.push(value);
  return fields;
}

async function loadSourceRows() {
  const raw = (await readFile(sourceCsv, 'utf8')).replace(/^\uFEFF/, '').trim();
  const [headerLine, ...lines] = raw.split(/\r?\n/);
  const columns = parseCsvLine(headerLine);
  return lines.map((line) => Object.fromEntries(columns.map((column, index) => [column, parseCsvLine(line)[index] ?? ''])));
}

const genders = [
  ...Array(19).fill('female'),
  ...Array(19).fill('male'),
  ...Array(2).fill('androgynous'),
];
const ages = [19, 22, 25, 28, 31, 34, 37, 41, 45, 49, 54, 59, 64, 69, 74];
const accents = [
  { id: 'ru-neutral', ru: 'нейтральный современный русский', en: 'neutral contemporary Russian', strength: 'none' },
  { id: 'ru-kz-urban', ru: 'русский Казахстана, городской вариант', en: 'urban Kazakhstan Russian, natural and non-caricatured', strength: 'slight' },
  { id: 'ru-kazakh-influenced', ru: 'русский с лёгким казахским влиянием', en: 'Russian with a slight natural Kazakh influence, never exaggerated', strength: 'slight' },
  { id: 'ru-regional-soft', ru: 'мягкий региональный русский', en: 'soft regional Russian accent', strength: 'slight' },
];
const timbres = ['warm and mellow', 'clear and bright', 'low and resonant', 'slightly raspy', 'soft and breathy', 'thin and light', 'dry and matter-of-fact', 'nasal but natural'];
const pitches = ['low', 'medium-low', 'medium', 'medium-high', 'high'];
const rhythms = ['even conversational rhythm', 'measured rhythm', 'slightly uneven casual rhythm', 'short clipped phrases', 'relaxed flowing rhythm', 'hesitant rhythm with small pauses'];
const articulations = ['precise', 'natural conversational', 'slightly reduced', 'soft consonants', 'crisp consonants', 'casual but intelligible'];
const baselineEmotions = ['neutral and focused', 'calm', 'slightly tired', 'friendly', 'businesslike', 'mildly distracted'];
const openAiVoices = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];
const googleFemaleVoices = ['Aoede', 'Autonoe', 'Callirrhoe', 'Despina', 'Erinome', 'Kore', 'Leda', 'Sulafat', 'Zephyr'];
const googleMaleVoices = ['Achird', 'Algenib', 'Charon', 'Enceladus', 'Fenrir', 'Iapetus', 'Orus', 'Puck', 'Umbriel'];
const yandexFemaleVoices = ['marina', 'masha', 'dasha', 'julia', 'lera', 'saule_ru', 'zamira_ru', 'zhanar_ru', 'yulduz_ru'];
const yandexMaleVoices = ['alexander', 'kirill', 'anton', 'madi_ru', 'filipp', 'ermil', 'zahar'];
const yandexVoiceRoles = {
  marina: ['neutral', 'whisper', 'friendly'],
  masha: ['good', 'strict', 'friendly'],
  dasha: ['neutral', 'good', 'friendly'],
  julia: ['neutral', 'strict'],
  lera: ['neutral', 'friendly'],
  saule_ru: ['neutral', 'strict', 'whisper'],
  zamira_ru: ['neutral', 'strict', 'friendly'],
  zhanar_ru: ['neutral', 'strict', 'friendly'],
  yulduz_ru: ['neutral', 'strict', 'friendly', 'whisper'],
  alexander: ['neutral', 'good'],
  kirill: ['neutral', 'strict', 'good'],
  anton: ['neutral', 'good'],
  madi_ru: [],
  filipp: [],
  ermil: ['neutral', 'good'],
  zahar: ['neutral', 'good'],
};

function xmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function resolveYandexRole(voice, mode) {
  const supported = yandexVoiceRoles[voice] ?? [];
  const desired = mode === 'correction' ? 'strict' : mode === 'paraphrase' ? 'friendly' : 'neutral';
  if (supported.includes(desired)) return desired;
  if (supported.includes('neutral')) return 'neutral';
  return supported[0] ?? null;
}

function ageRange(age) {
  if (age < 25) return '18–24';
  if (age < 35) return '25–34';
  if (age < 50) return '35–49';
  if (age < 65) return '50–64';
  return '65–75';
}

function makeSpeakerProfiles() {
  return Array.from({ length: 40 }, (_, index) => {
    const gender = genders[index];
    const age = ages[(index * 7) % ages.length];
    const accent = accents[index % accents.length];
    const timbre = timbres[(index * 3) % timbres.length];
    const pitch = pitches[(index * 2) % pitches.length];
    const rhythm = rhythms[(index * 5) % rhythms.length];
    const articulation = articulations[(index * 4) % articulations.length];
    const emotion = baselineEmotions[(index * 7) % baselineEmotions.length];
    const genderText = gender === 'female' ? 'Female' : gender === 'male' ? 'Male' : 'Androgynous adult voice';
    const voiceDescription = `Native Russian (${accent.en}). ${genderText}, perceived age ${ageRange(age)}. Excellent clean audio quality. Persona: everyday finance app user. Emotion: ${emotion}. ${timbre} timbre, ${pitch} pitch, ${rhythm}, ${articulation} articulation. Natural close-mic delivery without theatrical exaggeration.`;
    const humeDescription = `${emotion}, ${timbre}, ${rhythm}`.slice(0, 95);
    const yandexVoice = gender === 'female'
      ? yandexFemaleVoices[index % yandexFemaleVoices.length]
      : gender === 'male'
        ? yandexMaleVoices[index % yandexMaleVoices.length]
        : index % 2 ? 'marina' : 'alexander';
    return {
      id: `TTS-SPK-${String(index + 1).padStart(3, '0')}`,
      perceived_gender: gender,
      perceived_age: age,
      age_range: ageRange(age),
      native_language: 'ru-RU',
      region: index % 3 === 0 ? 'Kazakhstan' : 'Russian-speaking Eurasia',
      accent_id: accent.id,
      accent_description_ru: accent.ru,
      accent_description_en: accent.en,
      accent_strength: accent.strength,
      timbre,
      pitch,
      rhythm,
      articulation,
      baseline_emotion: emotion,
      voice_design_description: voiceDescription,
      openai_builtin_voice: openAiVoices[index % openAiVoices.length],
      openai_attribute_fidelity: 'target only; built-in voices may not reproduce requested gender/age exactly',
      google_chirp3_voice: `ru-RU-Chirp3-HD-${gender === 'female'
        ? googleFemaleVoices[index % googleFemaleVoices.length]
        : gender === 'male'
          ? googleMaleVoices[index % googleMaleVoices.length]
          : index % 2 ? 'Aoede' : 'Puck'}`,
      elevenlabs_voice_design: {
        endpoint: 'POST /v1/text-to-voice/design',
        model_id: 'eleven_ttv_v3',
        voice_description: voiceDescription,
        seed: 41000 + index,
        guidance_scale: 5,
        quality: 0.9,
        loudness: 0.5,
        selected_voice_id: null,
        create_selected_voice_endpoint: 'POST /v1/text-to-voice',
      },
      hume_voice_description: humeDescription,
      yandex_voice: yandexVoice,
      requires_auditory_validation: true,
    };
  });
}

const environmentProfiles = [
  ['quiet-bedroom', 'тихая спальня с мягкими поверхностями', 'Quiet small bedroom room tone, soft furnishings, nearly silent, seamless ambience, no speech', false, 'small_damped_room', [28, 36]],
  ['living-room-tv', 'гостиная с тихим телевизором в другой комнате', 'Living room ambience with a very distant muffled television, no intelligible words, steady room tone', true, 'medium_living_room', [12, 22]],
  ['kitchen', 'кухня с вытяжкой и редкой посудой', 'Kitchen ambience, steady extractor fan, refrigerator hum, occasional quiet dish clink, no voices', true, 'hard_kitchen', [10, 20]],
  ['open-office', 'открытый офис', 'Open-plan office ambience, HVAC, keyboard typing, chair movement, distant indistinct non-intelligible speech babble', true, 'office', [8, 18]],
  ['cafe', 'кафе средней загруженности', 'Busy cafe ambience, cups and cutlery, espresso machine, distant indistinct crowd babble, no intelligible foreground words', true, 'cafe', [4, 14]],
  ['street-light', 'спокойная улица', 'Urban sidewalk ambience, light traffic, occasional distant car pass-by, mild wind, no intelligible speech', true, 'outdoor', [8, 18]],
  ['street-heavy', 'шумный перекрёсток', 'Noisy city intersection, continuous traffic, buses, occasional horn, wind gusts, no sirens, no intelligible speech', true, 'outdoor', [1, 9]],
  ['park-wind', 'парк с ветром', 'City park ambience, birds, leaves rustling, irregular light wind gusts hitting a nearby microphone', true, 'outdoor', [6, 16]],
  ['car-idle', 'салон стоящего автомобиля', 'Inside a parked car, engine idling, ventilation fan, enclosed cabin resonance, no radio', true, 'car_cabin', [8, 18]],
  ['car-moving', 'салон движущегося автомобиля', 'Inside a moving car, road and tire noise, ventilation, occasional passing vehicle, no radio or speech', true, 'car_cabin', [2, 12]],
  ['bus', 'салон автобуса', 'Inside a city bus, engine vibration, road noise, door beeps in the distance, indistinct passenger murmur without clear words', true, 'bus_cabin', [2, 12]],
  ['supermarket', 'супермаркет', 'Supermarket ambience, refrigeration hum, cart wheels, distant checkout beeps, indistinct announcements with no recognizable words', true, 'large_store', [3, 13]],
  ['stairwell', 'лестничная клетка с эхом', 'Quiet concrete stairwell room tone, occasional distant door, long natural reverberation, no speech', true, 'stairwell', [14, 24]],
  ['large-hall', 'большой пустой холл', 'Large mostly empty hall ambience, subtle HVAC and long reverberation, sparse footsteps far away', true, 'large_hall', [12, 22]],
  ['bathroom', 'небольшое помещение с сильным отражением', 'Small tiled room ambience with short bright reflections and faint ventilation fan', true, 'tiled_room', [14, 24]],
  ['rain-window', 'дождь за закрытым окном', 'Steady rain against a closed window, soft indoor room tone, occasional heavier drops, no thunder', true, 'small_room', [8, 18]],
  ['construction-distant', 'ремонт в соседнем здании', 'Distant construction ambience, intermittent muffled drilling and hammering behind walls, indoor room tone', true, 'medium_room', [1, 12]],
  ['market', 'крытый рынок', 'Indoor market ambience, footsteps, bags, distant indistinct multilingual crowd babble, no intelligible foreground phrases', true, 'market_hall', [2, 12]],
  ['shared-room', 'комната с разговором на заднем плане', 'Indoor shared room with one distant competing speaker, heavily muffled and semantically unintelligible, steady room tone', true, 'medium_room', [0, 10]],
  ['silence', 'цифровая тишина', 'Near digital silence with extremely low microphone self-noise only', false, 'anechoic', [38, 45]],
].map(([id, descriptionRu, promptEn, generate, impulseResponse, snrRange]) => ({
  id,
  description_ru: descriptionRu,
  ambience_prompt_en: promptEn,
  generate_ambience: generate,
  impulse_response: impulseResponse,
  snr_db_range: snrRange,
  ambience_asset_id: generate ? `AMB-${id}` : null,
  elevenlabs_sound_effect_request: generate ? {
    endpoint: '/v1/sound-generation',
    model_id: 'eleven_text_to_sound_v2',
    text: promptEn,
    duration_seconds: 30,
    loop: true,
    prompt_influence: 0.55,
  } : null,
}));

const deviceProfiles = [
  ['studio-clean', 'чистый эталон', 48000, 'wav_pcm_s16le', 55, 18000, 0, 0, 0],
  ['iphone-near', 'современный iPhone в руке', 48000, 'opus_64k', 80, 16000, 2, -52, 0],
  ['android-midrange', 'Android среднего класса', 48000, 'opus_32k', 100, 14500, 2.5, -48, 0.01],
  ['phone-far', 'телефон на столе в метре', 48000, 'opus_32k', 140, 12000, 3, -45, 0.01],
  ['laptop-built-in', 'встроенный микрофон ноутбука', 48000, 'opus_32k', 120, 11000, 3.5, -44, 0.01],
  ['bluetooth-headset', 'Bluetooth-гарнитура', 16000, 'opus_24k', 150, 7500, 3, -46, 0.005],
  ['cheap-wired', 'недорогая проводная гарнитура', 16000, 'opus_20k', 180, 6800, 4, -42, 0.02],
  ['car-handsfree', 'автомобильная hands-free система', 16000, 'opus_24k', 170, 7200, 4, -40, 0.02],
  ['telephony', 'телефонный канал', 8000, 'mulaw_8k', 300, 3400, 4, -38, 0.01],
  ['damaged-mic', 'перегруженный или повреждённый микрофон', 16000, 'opus_16k', 200, 6000, 6, -36, 0.08],
].map(([id, descriptionRu, sampleRateHz, codec, highpassHz, lowpassHz, compressionRatio, noiseFloorDbfs, clipProbability]) => ({
  id,
  description_ru: descriptionRu,
  sample_rate_hz: sampleRateHz,
  channels: 1,
  final_codec: codec,
  highpass_hz: highpassHz,
  lowpass_hz: lowpassHz,
  compression_ratio: compressionRatio,
  noise_floor_dbfs: noiseFloorDbfs,
  clip_probability: clipProbability,
}));

function performanceFor(source, index) {
  const byMode = {
    scripted: ['neutral and precise', 'steady and matter-of-fact', 'clear but not theatrical'],
    paraphrase: ['casual conversational', 'spontaneous and relaxed', 'natural everyday delivery'],
    correction: ['hesitant at first, then firm corrective emphasis', 'self-correcting with a short pause', 'slightly distracted, then precise'],
    ambiguous: ['uncertain and hesitant', 'casual with uncertainty on the ambiguous phrase', 'matter-of-fact without resolving ambiguity'],
    invalid: ['natural literal delivery', 'slightly distracted', 'quiet and uncertain'],
  };
  const style = pick(byMode[source.mode]);
  const speedBase = source.mode === 'correction' || source.mode === 'ambiguous' ? 0.92 : source.mode === 'paraphrase' ? 1.04 : 1;
  const speed = round(clamp(speedBase + ((index % 9) - 4) * 0.035, 0.78, 1.18));
  const volumeDb = [-5, -3, -1, 0, 1, 2][index % 6];
  const pauseStyle = source.mode === 'correction' ? 'short pause immediately before the correction' : source.mode === 'ambiguous' ? 'small hesitation around the ambiguous words' : 'natural micro-pauses only';
  const vocalEvent = index % 20 === 0 ? 'one soft inhale before speaking' : index % 33 === 0 ? 'one subtle throat clear before speaking' : 'none';
  return { style, speed, volume_db: volumeDb, pause_style: pauseStyle, vocal_event: vocalEvent };
}

function openAiInstructions(speaker, performance) {
  return [
    'Speak in Russian and preserve every word of the input exactly; do not add, remove, correct, or paraphrase anything.',
    'Never speak these instructions or any stage directions.',
    `Target speaker: ${speaker.perceived_gender} adult, perceived age ${speaker.age_range}, ${speaker.accent_description_en}.`,
    `Voice: ${speaker.timbre}, ${speaker.pitch} pitch, ${speaker.articulation} articulation.`,
    `Delivery: ${performance.style}; ${speaker.rhythm}; ${performance.pause_style}; ${performance.vocal_event}.`,
    'Generate a clean close-microphone speech stem with no ambience, music, other speakers, echo, or sound effects; environment will be mixed separately.',
    'Pronounce all Russian financial numbers, dates, currencies, account names, and Latin brand names carefully while keeping the requested natural delivery.',
  ].join(' ');
}

function elevenTags(performance) {
  if (performance.style.includes('hesitant')) return '[thoughtful]';
  if (performance.style.includes('distracted')) return '[distracted]';
  if (performance.style.includes('firm')) return '[serious]';
  if (performance.style.includes('relaxed')) return '[calm]';
  return '[neutral]';
}

function makeJob(source, index, speakers) {
  const speaker = speakers[(index * 17) % speakers.length];
  const environment = environmentProfiles[(index * 7) % environmentProfiles.length];
  let device = deviceProfiles[(index * 3) % deviceProfiles.length];
  if (environment.id.startsWith('car-') && index % 2 === 0) device = deviceProfiles.find((item) => item.id === 'car-handsfree');
  if (source.expected_intent === 'no_speech') device = deviceProfiles[(index + 2) % deviceProfiles.length];
  const performance = performanceFor(source, index);
  const noSpeech = source.expected_intent === 'no_speech';
  const text = noSpeech ? '' : source.target_spoken_text;
  const snrMin = environment.snr_db_range[0];
  const snrMax = environment.snr_db_range[1];
  const snrDb = round(snrMin + random() * (snrMax - snrMin), 1);
  const seed = 900000 + index;
  const openaiInstructions = openAiInstructions(speaker, performance);
  const audioTag = elevenTags(performance);
  const yandexRole = resolveYandexRole(speaker.yandex_voice, source.mode);
  return {
    id: `TTS-${String(index + 1).padStart(4, '0')}`,
    source_scenario_id: source.id,
    source_mode: source.mode,
    render_text: text,
    expected: {
      intent: source.expected_intent,
      type: source.expected_type || null,
      amount: source.expected_amount || null,
      currency: source.expected_currency || null,
      date: source.expected_date || null,
      category: source.expected_category || null,
      account: source.expected_account || null,
      from_account: source.expected_from_account || null,
      to_account: source.expected_to_account || null,
      workspace: source.expected_workspace || null,
    },
    speaker_profile_id: speaker.id,
    speaker_snapshot: {
      perceived_gender: speaker.perceived_gender,
      perceived_age: speaker.perceived_age,
      age_range: speaker.age_range,
      accent: speaker.accent_description_ru,
      accent_strength: speaker.accent_strength,
      timbre: speaker.timbre,
      pitch: speaker.pitch,
      articulation: speaker.articulation,
      rhythm: speaker.rhythm,
    },
    performance,
    environment_profile_id: environment.id,
    device_profile_id: device.id,
    acoustic_mix: {
      ambience_asset_id: environment.ambience_asset_id,
      target_snr_db: snrDb,
      speech_gain_db: performance.volume_db,
      random_ambience_offset_seconds: round((index * 1.73) % 20, 2),
      impulse_response: environment.impulse_response,
      reverb_wet: environment.id === 'stairwell' || environment.id === 'large-hall' ? 0.28 : environment.id === 'bathroom' ? 0.2 : 0.06,
      limiter_ceiling_dbfs: -1,
      final_sample_rate_hz: device.sample_rate_hz,
      final_channels: 1,
      final_codec: device.final_codec,
      highpass_hz: device.highpass_hz,
      lowpass_hz: device.lowpass_hz,
      compression_ratio: device.compression_ratio,
      noise_floor_dbfs: device.noise_floor_dbfs,
      clip_probability: device.clip_probability,
    },
    provider_requests: {
      openai: noSpeech ? { skip_tts: true } : {
        endpoint: 'POST /v1/audio/speech',
        model: 'gpt-4o-mini-tts-2025-12-15',
        fallback_model: 'tts-1-hd',
        fallback_loses_instruction_control: true,
        verify_model_availability_before_run: true,
        voice: speaker.openai_builtin_voice,
        input: text,
        instructions: openaiInstructions,
        speed: performance.speed,
        response_format: 'wav',
        seed_support: false,
      },
      elevenlabs: noSpeech ? { skip_tts: true } : {
        endpoint: 'POST /v1/text-to-speech/{voice_id}',
        model_id: 'eleven_v3',
        fallback_model_id: 'eleven_multilingual_v2',
        voice_profile_id: speaker.id,
        voice_id: null,
        text: `${audioTag} ${text}`,
        clean_text_for_scoring: text,
        language_code: 'ru',
        seed,
        apply_text_normalization: 'auto',
        voice_settings: {
          stability: source.mode === 'scripted' ? 0.68 : source.mode === 'correction' ? 0.48 : 0.58,
          similarity_boost: 0.75,
          style: source.mode === 'scripted' ? 0.08 : 0.22,
          use_speaker_boost: true,
          speed: clamp(performance.speed, 0.7, 1.2),
        },
        output_format: 'pcm_44100',
        warning: 'Eleven v3 tags and short utterances are nondeterministic; validate that tags were not spoken literally.',
      },
      cartesia: noSpeech ? { skip_tts: true } : {
        endpoint: 'POST /tts/bytes',
        model_id: 'sonic-3',
        language: 'ru',
        voice_id: null,
        transcript: text,
        generation_config: {
          speed: clamp(performance.speed, 0.6, 1.5),
          volume: round(clamp(1 + performance.volume_db / 12, 0.5, 2), 2),
          emotion: performance.style,
        },
        output_format: { container: 'wav', sample_rate: 44100, encoding: 'pcm_s16le' },
      },
      hume: noSpeech ? { skip_tts: true } : {
        endpoint: 'POST /v0/tts/file',
        model: 'octave-2',
        language: 'ru',
        text,
        voice_name: null,
        speed: clamp(performance.speed, 0.5, 2),
        description: null,
        warning: 'Octave 2 supports Russian, but acting description is not yet supported; use speed and a validated predefined voice.',
      },
      azure: noSpeech ? { skip_tts: true } : {
        locale: 'ru-RU',
        voice_name: null,
        ssml_template: `<speak version="1.0" xml:lang="ru-RU"><voice name="{{RU_VOICE}}"><prosody rate="${Math.round((performance.speed - 1) * 100)}%" volume="${performance.volume_db}dB">${xmlEscape(text)}</prosody></voice></speak>`,
        warning: 'Select a current ru-RU voice and verify which styles/roles that exact voice supports before adding mstts:express-as.',
      },
      yandex: noSpeech ? { skip_tts: true } : {
        api: 'v3',
        language: 'ru-RU',
        text,
        hints: {
          voice: speaker.yandex_voice,
          ...(yandexRole ? { role: yandexRole } : {}),
          speed: performance.speed,
          pitch_shift: speaker.pitch === 'low' ? -80 : speaker.pitch === 'high' ? 80 : 0,
        },
        output_audio_spec: { container_audio: { container_audio_type: 'WAV' } },
        warning: 'Role was resolved against the documented per-voice role list; revalidate the list before a large run because provider capabilities can change.',
      },
      google: noSpeech ? { skip_tts: true } : {
        api: 'Cloud Text-to-Speech SynthesizeSpeech',
        endpoint_region: 'global',
        input: { text },
        voice: {
          language_code: 'ru-RU',
          name: speaker.google_chirp3_voice,
        },
        audio_config: {
          audio_encoding: 'LINEAR16',
          speaking_rate: clamp(performance.speed, 0.25, 2),
        },
        warning: 'Chirp 3 HD supports Russian and pace control, but the control is preview and persona fidelity must be checked by listening.',
      },
      aws_polly: noSpeech ? { skip_tts: true } : {
        api: 'Amazon Polly SynthesizeSpeech',
        request: {
          Engine: 'standard',
          LanguageCode: 'ru-RU',
          VoiceId: speaker.perceived_gender === 'male' ? 'Maxim' : 'Tatyana',
          Text: text,
          TextType: 'text',
          OutputFormat: 'pcm',
          SampleRate: '16000',
        },
        warning: 'Russian Tatyana and Maxim currently support only the standard engine; use as a low-controllability baseline, not as the primary realism source.',
      },
    },
    generation_seed: seed,
    validation: {
      preserve_exact_spoken_text: true,
      reject_if_stage_directions_are_spoken: true,
      reject_if_critical_amount_or_account_differs: true,
      roundtrip_stt_required: !noSpeech,
      clean_stem_required: !noSpeech,
      store_provider_model_and_request_hash: true,
    },
  };
}

function flattenJob(job) {
  return {
    id: job.id,
    source_scenario_id: job.source_scenario_id,
    source_mode: job.source_mode,
    render_text: job.render_text,
    expected_intent: job.expected.intent,
    expected_type: job.expected.type,
    expected_amount: job.expected.amount,
    expected_currency: job.expected.currency,
    speaker_profile_id: job.speaker_profile_id,
    perceived_gender: job.speaker_snapshot.perceived_gender,
    perceived_age: job.speaker_snapshot.perceived_age,
    accent: job.speaker_snapshot.accent,
    timbre: job.speaker_snapshot.timbre,
    pitch: job.speaker_snapshot.pitch,
    articulation: job.speaker_snapshot.articulation,
    rhythm: job.speaker_snapshot.rhythm,
    performance_style: job.performance.style,
    speed: job.performance.speed,
    environment_profile_id: job.environment_profile_id,
    device_profile_id: job.device_profile_id,
    target_snr_db: job.acoustic_mix.target_snr_db,
    final_codec: job.acoustic_mix.final_codec,
    openai_voice: job.provider_requests.openai.voice ?? '',
    openai_instructions: job.provider_requests.openai.instructions ?? '',
    elevenlabs_model: job.provider_requests.elevenlabs.model_id ?? '',
    elevenlabs_voice_profile_id: job.provider_requests.elevenlabs.voice_profile_id ?? '',
    ambience_asset_id: job.acoustic_mix.ambience_asset_id ?? '',
    generation_seed: job.generation_seed,
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows) {
  const columns = Object.keys(rows[0]);
  return `\uFEFF${columns.map(csvEscape).join(';')}\n${rows.map((row) => columns.map((column) => csvEscape(row[column])).join(';')).join('\n')}\n`;
}

async function writeJson(path, data) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function main() {
  await mkdir(partsDir, { recursive: true });
  const sourceRows = await loadSourceRows();
  if (sourceRows.length !== 1000) throw new Error(`Expected 1000 source rows, got ${sourceRows.length}`);
  const speakers = makeSpeakerProfiles();
  const jobs = sourceRows.map((source, index) => makeJob(source, index, speakers));

  await writeJson(resolve(outputDir, 'speaker_profiles.json'), speakers);
  await writeJson(resolve(outputDir, 'environment_profiles.json'), environmentProfiles);
  await writeJson(resolve(outputDir, 'device_profiles.json'), deviceProfiles);
  await writeJson(resolve(outputDir, 'ambience_assets.json'), environmentProfiles.filter((item) => item.generate_ambience).map((item) => ({
    id: item.ambience_asset_id,
    environment_profile_id: item.id,
    prompt: item.ambience_prompt_en,
    elevenlabs_request: item.elevenlabs_sound_effect_request,
    generate_once_and_reuse: true,
  })));
  await writeFile(resolve(outputDir, 'all_tts_scenarios.jsonl'), `${jobs.map((job) => JSON.stringify(job)).join('\n')}\n`, 'utf8');
  await writeFile(resolve(outputDir, 'all_tts_scenarios.csv'), toCsv(jobs.map(flattenJob)), 'utf8');

  for (let part = 1; part <= 10; part += 1) {
    const subset = jobs.slice((part - 1) * 100, part * 100);
    const suffix = String(part).padStart(2, '0');
    await writeFile(resolve(partsDir, `tts_scenarios_${suffix}.jsonl`), `${subset.map((job) => JSON.stringify(job)).join('\n')}\n`, 'utf8');
    await writeFile(resolve(partsDir, `tts_scenarios_${suffix}.csv`), toCsv(subset.map(flattenJob)), 'utf8');
  }

  const summary = {
    total: jobs.length,
    speaker_profiles: speakers.length,
    environment_profiles: environmentProfiles.length,
    device_profiles: deviceProfiles.length,
    ambience_assets: environmentProfiles.filter((item) => item.generate_ambience).length,
    providers: ['openai', 'elevenlabs', 'cartesia', 'hume', 'azure', 'yandex', 'google', 'aws_polly'],
    no_speech_jobs: jobs.filter((job) => job.expected.intent === 'no_speech').length,
    snr_db: {
      min: Math.min(...jobs.map((job) => job.acoustic_mix.target_snr_db)),
      max: Math.max(...jobs.map((job) => job.acoustic_mix.target_snr_db)),
    },
  };
  await writeJson(resolve(outputDir, 'summary.json'), summary);

  const uniqueIds = new Set(jobs.map((job) => job.id));
  if (uniqueIds.size !== 1000) throw new Error('TTS job IDs are not unique');
  if (jobs.some((job) => job.expected.intent !== 'no_speech' && !job.render_text)) throw new Error('Speech job without render_text');
  process.stdout.write(`${JSON.stringify({ outputDir, ...summary }, null, 2)}\n`);
}

await main();
