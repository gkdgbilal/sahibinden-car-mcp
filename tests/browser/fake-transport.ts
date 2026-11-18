import type { Transport } from '../../src/browser/transport.js';

export type FakeHandler = (msg: any, t: FakeTransport) => void;

/** Bellek içi sahte taşıma: gönderilenleri kaydeder, yanıt/olay üretir. */
export class FakeTransport implements Transport {
  sent: any[] = [];
  closed = false;
  private messageCb: ((d: string) => void) | null = null;
  private closeCb: (() => void) | null = null;
  private handler: FakeHandler | null = null;

  send(data: string): void {
    const msg = JSON.parse(data);
    this.sent.push(msg);
    this.handler?.(msg, this);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCb?.();
  }
  onMessage(cb: (d: string) => void): void {
    this.messageCb = cb;
  }
  onClose(cb: () => void): void {
    this.closeCb = cb;
  }

  reply(id: number, result: object = {}): void {
    this.messageCb?.(JSON.stringify({ id, result }));
  }
  replyError(id: number, message: string): void {
    this.messageCb?.(JSON.stringify({ id, error: { code: -32000, message } }));
  }
  emit(method: string, params: object = {}, sessionId?: string): void {
    this.messageCb?.(JSON.stringify({ method, params, ...(sessionId ? { sessionId } : {}) }));
  }
  triggerClose(): void {
    this.closed = true;
    this.closeCb?.();
  }
  /** Her isteğe handler ile yanıt verir: sonuç nesnesi döndürürse reply, undefined ise sessiz kalır. */
  autoRespond(fn: (msg: any) => object | undefined): void {
    this.handler = (msg, t) => {
      const r = fn(msg);
      if (r !== undefined) t.reply(msg.id, r);
    };
  }
}
