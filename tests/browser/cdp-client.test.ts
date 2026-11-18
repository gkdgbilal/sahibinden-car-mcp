import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALLOWED_METHODS, CdpClient } from '../../src/browser/cdp-client.js';
import { FakeTransport } from './fake-transport.js';

afterEach(() => vi.useRealTimers());

describe('CdpClient', () => {
  it('istek id eşlemesi: paralel iki istek doğru yanıtlanır', async () => {
    const t = new FakeTransport();
    const c = new CdpClient(t);
    const a = c.send('Browser.getVersion');
    const b = c.send('Page.enable');
    expect(t.sent.map((m) => m.id)).toEqual([1, 2]);
    t.reply(2, { which: 'b' });
    t.reply(1, { which: 'a' });
    expect(await a).toEqual({ which: 'a' });
    expect(await b).toEqual({ which: 'b' });
  });

  it('sessionId ve params iletilir; yoksa alan eklenmez', async () => {
    const t = new FakeTransport();
    t.autoRespond(() => ({}));
    const c = new CdpClient(t);
    await c.send('Page.navigate', { url: 'about:blank' }, 'S1');
    await c.send('Browser.getVersion');
    expect(t.sent[0]).toEqual({ id: 1, method: 'Page.navigate', params: { url: 'about:blank' }, sessionId: 'S1' });
    expect(t.sent[1]).toEqual({ id: 2, method: 'Browser.getVersion' });
  });

  it('CDP hata yanıtı reject eder', async () => {
    const t = new FakeTransport();
    const c = new CdpClient(t);
    const p = c.send('Page.navigate', { url: 'x' });
    t.replyError(1, 'Cannot navigate');
    await expect(p).rejects.toThrow('Cannot navigate');
  });

  it('zaman aşımı: code=timeout', async () => {
    vi.useFakeTimers();
    const c = new CdpClient(new FakeTransport(), { requestTimeoutMs: 1000 });
    const p = c.send('Browser.getVersion');
    const assertion = expect(p).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  });

  it('kapanışta bekleyen istekler ve waitFor not-running ile reddedilir', async () => {
    const t = new FakeTransport();
    const c = new CdpClient(t);
    const p = c.send('Browser.getVersion');
    const w = c.waitFor('Page.loadEventFired', () => true, 5000);
    const checks = Promise.all([
      expect(p).rejects.toMatchObject({ code: 'not-running' }),
      expect(w).rejects.toMatchObject({ code: 'not-running' }),
    ]);
    t.triggerClose();
    await checks;
    expect(c.closed).toBe(true);
    await expect(c.send('Browser.getVersion')).rejects.toMatchObject({ code: 'not-running' });
  });

  it('waitFor: koşulu sağlayan olayı bekler, olay dinleyicisi sessionId alır', async () => {
    const t = new FakeTransport();
    const c = new CdpClient(t);
    const seen: (string | undefined)[] = [];
    const off = c.on('Page.frameNavigated', (_p, sid) => void seen.push(sid));
    const w = c.waitFor<{ n: number }>('Page.loadEventFired', (p) => p.n === 2, 5000);
    t.emit('Page.loadEventFired', { n: 1 }, 'S');
    t.emit('Page.frameNavigated', {}, 'S9');
    t.emit('Page.loadEventFired', { n: 2 }, 'S');
    expect(await w).toEqual({ n: 2 });
    off();
    t.emit('Page.frameNavigated', {}, 'S10');
    expect(seen).toEqual(['S9']);
  });

  it('waitFor zaman aşımı', async () => {
    vi.useFakeTimers();
    const c = new CdpClient(new FakeTransport());
    const w = c.waitFor('Page.loadEventFired', () => true, 500);
    const assertion = expect(w).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(501);
    await assertion;
  });

  it('izin listesi tam 10 metot', () => {
    expect([...ALLOWED_METHODS].sort()).toEqual(
      [
        'Browser.getVersion', 'Network.enable', 'Page.enable', 'Page.navigate', 'Runtime.evaluate',
        'Target.attachToTarget', 'Target.closeTarget', 'Target.createTarget', 'Target.detachFromTarget',
        'Target.getTargetInfo',
      ].sort(),
    );
  });

  const forbidden = [
    'Input.dispatchMouseEvent',
    'Input.dispatchKeyEvent',
    'Emulation.setUserAgentOverride',
    'Emulation.setDeviceMetricsOverride',
    'Network.getCookies',
    'Network.getAllCookies',
    'Storage.getCookies',
    'Fetch.enable',
    'Page.addScriptToEvaluateOnNewDocument',
    'Runtime.enable',
    'Target.setAutoAttach',
    'Target.getTargets',
    'Network.setUserAgentOverride',
    'Network.setExtraHTTPHeaders',
  ];
  it.each(forbidden)('yasaklı metot %s reddedilir ve taşımaya hiçbir şey gitmez', async (method) => {
    const t = new FakeTransport();
    const c = new CdpClient(t);
    await expect(c.send(method, {}, 'S')).rejects.toThrow(`CDP method not allowed: ${method}`);
    expect(t.sent).toEqual([]);
  });
});
