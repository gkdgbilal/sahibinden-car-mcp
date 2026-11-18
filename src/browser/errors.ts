export type LiveStatus =
  | 'ok'
  | 'partial'
  | 'disabled'
  | 'unsupported-runtime'
  | 'not-running'
  | 'challenge-detected'
  | 'challenge-pending'
  | 'login-required'
  | 'unexpected-page'
  | 'timeout'
  | 'navigation-error'
  | 'deadline'
  | 'hourly-cap'
  | 'busy';

/** Tarayıcı modunda beklenen (yapısal olarak raporlanan) hata; `code` canlı çağrının durumuna dönüşür. */
export class BrowserError extends Error {
  constructor(
    readonly code: LiveStatus,
    message: string,
    readonly userAction?: string,
    /** hourly-cap / busy gibi durumlarda bir sonraki izinli an (epoch ms). */
    readonly nextAllowedAt?: number,
  ) {
    super(message);
    this.name = 'BrowserError';
  }
}

export const START_CHROME_HINT = "npm run chrome ile adanmış Chrome'u başlatın";
