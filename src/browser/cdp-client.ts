import { BrowserError } from './errors.js';
import type { Transport } from './transport.js';

/**
 * Gönderilmesine izin verilen tek CDP metotları. Bunun dışındaki her şey (fare/klavye olayları, ortam taklidi,
 * cookie/depolama okuma, betik enjeksiyonu, otomatik attach ...) taşımaya hiç ulaşmadan reddedilir.
 */
export const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  'Browser.getVersion',
  'Target.createTarget',
  'Target.attachToTarget',
  'Target.detachFromTarget',
  'Target.closeTarget',
  'Target.getTargetInfo',
  'Page.enable',
  'Page.navigate',
  'Network.enable',
  'Runtime.evaluate',
]);

type Listener = (params: any, sessionId?: string) => void;

interface Pending {
  method: string;
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly waiters = new Set<(e: Error) => void>();
  private readonly requestTimeoutMs: number;
  private isClosed = false;

  constructor(private readonly transport: Transport, opts: { requestTimeoutMs?: number } = {}) {
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 10_000;
    transport.onMessage((d) => this.handleMessage(d));
    transport.onClose(() => this.shutdown());
  }

  get closed(): boolean {
    return this.isClosed;
  }

  send<T = unknown>(method: string, params?: object, sessionId?: string): Promise<T> {
    if (!ALLOWED_METHODS.has(method)) {
      return Promise.reject(new Error(`CDP method not allowed: ${method}`));
    }
    if (this.isClosed) {
      return Promise.reject(new BrowserError('not-running', 'Chrome bağlantısı kapandı'));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BrowserError('timeout', `CDP isteği zaman aşımına uğradı: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      const msg: Record<string, unknown> = { id, method };
      if (params !== undefined) msg.params = params;
      if (sessionId !== undefined) msg.sessionId = sessionId;
      try {
        this.transport.send(JSON.stringify(msg));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Olay dinleyicisi ekler; dinlemeyi bırakan fonksiyonu döner. */
  on(method: string, cb: Listener): () => void {
    let set = this.listeners.get(method);
    if (!set) this.listeners.set(method, (set = new Set()));
    set.add(cb);
    return () => void set.delete(cb);
  }

  /** Koşulu sağlayan ilk olayı bekler; süre dolarsa 'timeout', bağlantı kapanırsa 'not-running' ile reddeder. */
  waitFor<T = any>(method: string, pred: (p: T, sessionId?: string) => boolean, timeoutMs: number): Promise<T> {
    if (this.isClosed) return Promise.reject(new BrowserError('not-running', 'Chrome bağlantısı kapandı'));
    return new Promise<T>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        off();
        this.waiters.delete(onFail);
      };
      const onFail = (e: Error) => {
        done();
        reject(e);
      };
      const off = this.on(method, (p, sid) => {
        let ok = false;
        try {
          ok = pred(p, sid);
        } catch {
          ok = false;
        }
        if (ok) {
          done();
          resolve(p as T);
        }
      });
      const timer = setTimeout(
        () => onFail(new BrowserError('timeout', `CDP olayı beklenirken zaman aşımı: ${method}`)),
        timeoutMs,
      );
      this.waiters.add(onFail);
    });
  }

  close(): void {
    this.shutdown();
    this.transport.close();
  }

  private shutdown(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    const err = () => new BrowserError('not-running', 'Chrome bağlantısı kapandı');
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err());
    }
    this.pending.clear();
    for (const fail of [...this.waiters]) fail(err());
    this.waiters.clear();
  }

  private handleMessage(data: string): void {
    let msg: any;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;
    if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(String(msg.error.message ?? `CDP hatası: ${p.method}`)));
      else p.resolve(msg.result ?? {});
      return;
    }
    if (typeof msg.method === 'string') {
      for (const cb of [...(this.listeners.get(msg.method) ?? [])]) {
        try {
          cb(msg.params, msg.sessionId);
        } catch {
          /* dinleyici hatası bağlantıyı bozmaz */
        }
      }
    }
  }
}
