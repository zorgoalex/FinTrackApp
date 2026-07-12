import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square, X } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { sttClient } from '../services/appStt';

function formatTime(seconds) {
  return `0:${String(seconds).padStart(2, '0')}`;
}
function errorMessage(error) {
  if (error?.code === 'PROVIDER_RATE_LIMITED') return 'Лимит распознавания временно исчерпан. Попробуйте чуть позже.';
  if (error?.code === 'FILE_TOO_LARGE') return 'Запись слишком длинная. Попробуйте ещё раз короче.';
  if (error?.code === 'UNAUTHORIZED') return 'Сессия истекла. Обновите страницу и войдите снова.';
  return error?.message || 'Не удалось распознать запись';
}

export default function VoiceOperationInput({ disabled = false, onTranscript }) {
  const { status, elapsedSeconds, recording, error: recorderError, start, stop, cancel } = useAudioRecorder({ maxDurationSeconds: 30 });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [appliedFields, setAppliedFields] = useState([]);
  const [meta, setMeta] = useState(null);
  const processedRecordingId = useRef(null);

  useEffect(() => {
    if (!recording || processedRecordingId.current === recording.id) return;
    processedRecordingId.current = recording.id;
    let active = true;
    setProcessing(true);
    setError('');
    sttClient.transcribe(recording.blob, { language: 'ru', timestamps: 'segment' })
      .then((result) => {
        if (!active) return;
        if (!result.transcript.trim()) throw new Error('Речь не распознана. Говорите ближе к микрофону.');
        setTranscript(result.transcript);
        setMeta({ provider: result.provider, model: result.model, latencyMs: result.latencyMs });
        const applied = onTranscript?.(result.transcript, result);
        setAppliedFields(applied?.appliedFields || []);
      })
      .catch((transcriptionError) => active && setError(errorMessage(transcriptionError)))
      .finally(() => active && setProcessing(false));
    return () => { active = false; };
  }, [onTranscript, recording]);

  const beginRecording = () => {
    setError('');
    setTranscript('');
    setAppliedFields([]);
    setMeta(null);
    start();
  };

  const isRecording = status === 'recording';
  const busy = disabled || processing || status === 'requesting';
  const triggerLabel = processing
    ? 'Распознаю запись'
    : status === 'requesting'
      ? 'Запрашиваю доступ к микрофону'
      : transcript
        ? 'Записать операцию заново'
        : 'Продиктовать операцию';

  return (
    <section className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 dark:border-indigo-800 dark:bg-indigo-950/30" aria-label="Голосовой ввод операции">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200">Голосовой ввод</p>
          <p className="text-xs text-indigo-700/80 dark:text-indigo-300/70">Продиктуйте тип, сумму, категорию и счёт</p>
        </div>
        {!isRecording && (
          <button type="button" onClick={beginRecording} disabled={busy} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-indigo-600 text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50" aria-label={triggerLabel} title={triggerLabel}>
            {busy ? <Loader2 size={20} className="animate-spin" /> : <Mic size={20} />}
          </button>
        )}
      </div>

      {isRecording && (
        <div className="mt-3 flex items-center gap-2" role="status" aria-live="polite">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          <span className="mr-auto text-sm font-medium text-red-700 dark:text-red-300">Запись {formatTime(elapsedSeconds)} / 0:30</span>
          <button type="button" onClick={cancel} className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300" aria-label="Отменить запись"><X size={17} /></button>
          <button type="button" onClick={stop} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700" aria-label="Остановить и распознать запись"><Square size={15} fill="currentColor" /> Готово</button>
        </div>
      )}

      {(error || recorderError) && <p className="mt-2 text-sm text-red-700 dark:text-red-300" role="alert">{error || recorderError}</p>}
      {transcript && !error && (
        <div className="mt-3 rounded-lg bg-white/80 p-3 dark:bg-gray-900/50">
          <p className="text-sm text-gray-800 dark:text-gray-100">«{transcript}»</p>
          {appliedFields.length > 0 && <p className="mt-1 text-xs text-green-700 dark:text-green-300">Заполнено: {appliedFields.join(', ')}</p>}
          {meta && <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">{meta.provider} · {meta.model}{meta.latencyMs ? ` · ${(meta.latencyMs / 1000).toFixed(1)} с` : ''}</p>}
        </div>
      )}
      <p className="mt-2 text-[11px] text-indigo-700/70 dark:text-indigo-300/60">Запись отправляется только для распознавания и не сохраняется. Проверьте сумму перед сохранением.</p>
    </section>
  );
}
