export type SttErrorCode =
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'FILE_TOO_LARGE'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'INVALID_PROVIDER_RESPONSE';

export class SttError extends Error {
  constructor(
    public readonly code: SttErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'SttError';
  }
}
