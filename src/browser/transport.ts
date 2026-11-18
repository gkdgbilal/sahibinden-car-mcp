import { BrowserError, START_CHROME_HINT } from './errors.js';

export interface Transport {
  send(data: string): void;
  close(): void;
  onMessage(cb: (data: string) => void): void;
  onClose(cb: () => void): void;
}

/** CDP tarayıcı uç noktası: yalnızca loopback (127.0.0.1) ve /devtools/browser/<id> yolu. */
export const LOOPBACK_WS = /^ws:\/\/127\.0\.0\.1:\d{1,5}\/devtools\/browser\/[\w-]+$/;

/**
 * Node'un global WebSocket'i ile loopback CDP bağlantısı açar (kodda tek WebSocket kullanımı burasıdır).
 * Ek başlık veya Origin gönderilmez.
 */
export function openLoopbackTransport(url: string, timeoutMs = 5000): Promise<Transport> {
  if (!LOOPBACK_WS.test(url)) {
    return Promise.reject(new BrowserError('not-running', 'Yalnızca 127.0.0.1 CDP adresine bağlanılır'));
  }
  if (typeof globalThis.WebSocket !== 'function') {
    return Promise.reject(new BrowserError('unsupported-runtime', 'Tarayıcı modu Node 22.12+ ister', 'Node 22.12 veya üstünü kullanın'));
  }
  return new Promise<Transport>((resolve, reject) => {
    const ws = new globalThis.WebSocket(url);
    let settled = false;
    const messageCbs: ((d: string) => void)[] = [];
    const closeCbs: (() => void)[] = [];
    const fail = (why: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* zaten kapalı */
      }
      reject(new BrowserError('not-running', `Chrome'a bağlanılamadı (${why})`, START_CHROME_HINT));
    };
    const timer = setTimeout(() => fail('zaman aşımı'), timeoutMs);

    ws.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        send: (data) => ws.send(data),
        close: () => {
          try {
            ws.close();
          } catch {
            /* zaten kapalı */
          }
        },
        onMessage: (cb) => void messageCbs.push(cb),
        onClose: (cb) => void closeCbs.push(cb),
      });
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') for (const cb of messageCbs) cb(ev.data);
    };
    ws.onerror = () => fail('bağlantı hatası');
    ws.onclose = () => {
      if (!settled) return fail('bağlantı kapandı');
      for (const cb of closeCbs) cb();
    };
  });
}
