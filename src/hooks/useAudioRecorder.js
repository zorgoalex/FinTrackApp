import { useCallback, useEffect, useRef, useState } from 'react';

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

function preferredMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported?.(type)) || '';
}
function recorderError(error) {
  if (error?.name === 'NotAllowedError') return 'Разрешите доступ к микрофону в настройках браузера';
  if (error?.name === 'NotFoundError') return 'Микрофон не найден';
  if (error?.name === 'NotReadableError') return 'Микрофон занят другим приложением';
  return error?.message || 'Не удалось начать запись';
}

export function useAudioRecorder({ maxDurationSeconds = 30 } = {}) {
  const [status, setStatus] = useState('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recording, setRecording] = useState(null);
  const [error, setError] = useState('');
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const discardRef = useRef(false);
  const intervalRef = useRef(null);
  const timeoutRef = useRef(null);

  const clearTimers = useCallback(() => {
    clearInterval(intervalRef.current);
    clearTimeout(timeoutRef.current);
    intervalRef.current = null;
    timeoutRef.current = null;
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const cancel = useCallback(() => {
    discardRef.current = true;
    stop();
  }, [stop]);

  const start = useCallback(async () => {
    if (status !== 'idle') return;
    setError('');
    setRecording(null);
    setElapsedSeconds(0);
    setStatus('requesting');
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Этот браузер не поддерживает запись с микрофона');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const mimeType = preferredMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      discardRef.current = false;
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onerror = (event) => setError(recorderError(event.error));
      recorder.onstop = () => {
        clearTimers();
        releaseStream();
        setStatus('idle');
        if (!discardRef.current && chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          setRecording({ id: Date.now(), blob });
        }
        recorderRef.current = null;
      };
      recorder.start(250);
      setStatus('recording');
      const startedAt = Date.now();
      intervalRef.current = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
      timeoutRef.current = setTimeout(() => recorder.state === 'recording' && recorder.stop(), maxDurationSeconds * 1000);
    } catch (startError) {
      clearTimers();
      releaseStream();
      setStatus('idle');
      setError(recorderError(startError));
    }
  }, [clearTimers, maxDurationSeconds, releaseStream, status]);

  useEffect(() => () => {
    discardRef.current = true;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    clearTimers();
    releaseStream();
  }, [clearTimers, releaseStream]);

  return { status, elapsedSeconds, recording, error, start, stop, cancel, clearError: () => setError('') };
}
