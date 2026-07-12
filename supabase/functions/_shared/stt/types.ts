export type SttProviderId = 'groq';
export type TimestampGranularity = 'segment' | 'word';

export type SttRequest = {
  audio: File;
  language?: string;
  prompt?: string;
  timestampGranularities: TimestampGranularity[];
};

export type SttSegment = {
  start_seconds: number;
  end_seconds: number;
  text: string;
  avg_log_probability: number | null;
  no_speech_probability: number | null;
  compression_ratio: number | null;
};

export type SttWord = {
  start_seconds: number;
  end_seconds: number;
  text: string;
};

export type SttResult = {
  transcript: string;
  provider: SttProviderId;
  model: string;
  language: string | null;
  duration_seconds: number | null;
  segments: SttSegment[];
  words: SttWord[];
  request_id: string | null;
  latency_ms: number;
};

export interface SttProvider {
  readonly id: SttProviderId;
  transcribe(request: SttRequest): Promise<SttResult>;
}
