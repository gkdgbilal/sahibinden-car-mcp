import { describe, expect, it } from 'vitest';
import { ALLOWED_METHODS, CdpClient } from '../../src/browser/cdp-client.js';
import { CdpPageSource } from '../../src/browser/cdp-page-source.js';
import { FakeTransport } from './fake-transport.js';

interface Script {
  kinds?: string[];
  html?: string;
  href?: string;
  status?: number;
  headers?: Record<string, string>;
  loadEvent?: boolean;
  errorText?: string;
  infoMissing?: boolean;
}

function setup(script: Script, sleep = async (_ms: number) => {}, now?: () => number) {
  const t = new FakeTransport();
  const kinds = [...(script.kinds ?? ['ready'])];
  t.autoRespond((m) => {
    switch (m.method) {
      case 'Browser.getVersion':
        return { product: 'Chrome/999' };
      case 'Target.createTarget':
        return { targetId: 'T1' };
      case 'Target.attachToTarget':
        return { sessionId: 'S1' };
      case 'Target.getTargetInfo':
        return script.infoMissing ? undefined : { targetInfo: { targetId: 'T1' } };
      case 'Page.navigate':
        if (script.errorText) return { frameId: 'F1', errorText: script.errorText };
        t.emit('Network.responseReceived', {
          type: 'Document', frameId: 'F1', response: { status: script.status ?? 200, headers: script.headers ?? {} },
        }, 'S1');
        // Aynı oturumda ilgisiz bir alt kaynak yanıtı: yok sayılmalı.
        t.emit('Network.responseReceived', { type: 'Script', frameId: 'F1', response: { status: 500, headers: {} } }, 'S1');
        if (script.loadEvent !== false) t.emit('Page.loadEventFired', {}, 'S1');
        return { frameId: 'F1' };
      case 'Runtime.evaluate': {
        const e: string = m.params.expression;
        const value = e.includes('readyState')
          ? (kinds.length > 1 ? kinds.shift() : kinds[0])
          : e === 'location.href'
            ? (script.href ?? 'https://www.sahibinden.com/x')
            : e === 'document.documentElement.outerHTML'
              ? (script.html ?? '<html></html>')
              : 'UNEXPECTED';
        return { result: { value } };
      }
      case 'Target.closeTarget':
        return { success: true };
      default:
        return {};
    }
  });
  if (script.infoMissing) {
    const orig = t.send.bind(t);
    t.send = (data: string) => {
      const m = JSON.parse(data);
      if (m.method === 'Target.getTargetInfo') {
        t.sent.push(m);
        t.replyError(m.id, 'No target with given id found');
        return;
      }
      orig(data);
    };
  }
  const client = new CdpClient(t, { requestTimeoutMs: 1000 });
  const source = new CdpPageSource({
    profileDir: '/unused',
    connect: async () => client,
    pollMs: 500,
    settleMs: 2000,
    sleep,
    ...(now ? { now } : {}),
  });
  return { t, client, source };
}

function fakeClock() {
  const c = { t: 0, sleeps: [] as number[] };
  return {
    c,
    now: () => c.t,
    sleep: async (ms: number) => {
      c.sleeps.push(ms);
      c.t += ms;
    },
  };
}

describe('CdpPageSource', () => {
  it('openTab: doğru komut sırası ve yalnızca izinli metotlar', async () => {
    const { t, source } = setup({});
    const session = await source.connect();
    expect(await session.version()).toBe('Chrome/999');
    const tab = await session.openTab();
    expect(tab.targetId).toBe('T1');
    const seq = t.sent.map((m) => m.method);
    expect(seq).toEqual(['Browser.getVersion', 'Target.createTarget', 'Target.attachToTarget', 'Page.enable', 'Network.enable']);
    expect(t.sent[1].params).toEqual({ url: 'about:blank' });
    expect(t.sent[2].params).toEqual({ targetId: 'T1', flatten: true });
    expect(t.sent[3].sessionId).toBe('S1');
    expect(t.sent[4].sessionId).toBe('S1');
    for (const m of t.sent) expect(ALLOWED_METHODS.has(m.method)).toBe(true);
  });

  it('navigate: 403 + cf-mitigated (büyük/küçük harf duyarsız) + challenge işareti', async () => {
    const { t, source } = setup({ status: 403, headers: { 'CF-Mitigated': 'challenge' }, kinds: ['challenge'], href: 'https://www.sahibinden.com/otomobil' });
    const tab = await (await source.connect()).openTab();
    const r = await tab.navigate('https://www.sahibinden.com/otomobil', 5000);
    expect(r).toEqual({
      finalUrl: 'https://www.sahibinden.com/otomobil',
      httpStatus: 403,
      cfMitigated: true,
      errorText: null,
      quickKind: 'challenge',
    });
    const nav = t.sent.find((m) => m.method === 'Page.navigate');
    expect(nav).toMatchObject({ params: { url: 'https://www.sahibinden.com/otomobil' }, sessionId: 'S1' });
    // Kullanıcı etkileşimi/gizleme/cookie metotları hiç gönderilmedi.
    for (const m of t.sent) expect(ALLOWED_METHODS.has(m.method)).toBe(true);
  });

  it('navigate: load + yoklama ready; yoklama aralığı sabit 500 ms', async () => {
    const ck = fakeClock();
    const { source } = setup({ kinds: ['loading', 'loading', 'ready'] }, ck.sleep, ck.now);
    const tab = await (await source.connect()).openTab();
    const r = await tab.navigate('https://www.sahibinden.com/x', 30_000);
    expect(r).toMatchObject({ quickKind: 'ready', httpStatus: 200, cfMitigated: false });
    expect(ck.c.sleeps).toEqual([500, 500]);
  });

  it('hazır işareti yoksa sayfa complete olduktan 2 sn sonra ready', async () => {
    const ck = fakeClock();
    const { source } = setup({ kinds: ['complete'] }, ck.sleep, ck.now);
    const tab = await (await source.connect()).openTab();
    const r = await tab.navigate('https://www.sahibinden.com/x', 30_000);
    expect(r.quickKind).toBe('ready');
    expect(ck.c.sleeps).toEqual([500, 500, 500, 500]);
  });

  it('challenge görülür görülmez erken döner (bekleme yok)', async () => {
    const ck = fakeClock();
    const { source } = setup({ kinds: ['challenge'] }, ck.sleep, ck.now);
    const tab = await (await source.connect()).openTab();
    expect((await tab.navigate('https://www.sahibinden.com/x', 30_000)).quickKind).toBe('challenge');
    expect(ck.c.sleeps).toEqual([]);
  });

  it('süre dolarsa timeout', async () => {
    const ck = fakeClock();
    const { source } = setup({ kinds: ['loading'] }, ck.sleep, ck.now);
    const tab = await (await source.connect()).openTab();
    const r = await tab.navigate('https://www.sahibinden.com/x', 3000);
    expect(r.quickKind).toBe('timeout');
    expect(ck.c.t).toBeGreaterThanOrEqual(3000);
  });

  it('load olayı gelmezse (gerçek kısa süre) timeout', async () => {
    const { source } = setup({ kinds: ['loading'], loadEvent: false });
    const tab = await (await source.connect()).openTab();
    expect((await tab.navigate('https://www.sahibinden.com/x', 50)).quickKind).toBe('timeout');
  });

  it('errorText → ağ hatası olarak döner, yoklama yapılmaz', async () => {
    const { t, source } = setup({ errorText: 'net::ERR_NAME_NOT_RESOLVED' });
    const tab = await (await source.connect()).openTab();
    const r = await tab.navigate('https://www.sahibinden.com/x', 5000);
    expect(r.errorText).toBe('net::ERR_NAME_NOT_RESOLVED');
    expect(t.sent.some((m) => m.method === 'Runtime.evaluate')).toBe(false);
  });

  it('html() sabit ifadeyle okunur; currentKind eşlemesi', async () => {
    const { t, source } = setup({ html: '<html>x</html>', kinds: ['challenge'] });
    const tab = await (await source.connect()).openTab();
    expect(await tab.html()).toBe('<html>x</html>');
    expect(await tab.currentKind()).toBe('challenge');
    const exprs = t.sent.filter((m) => m.method === 'Runtime.evaluate').map((m) => m.params);
    expect(exprs[0]).toEqual({ expression: 'document.documentElement.outerHTML', returnByValue: true });
  });

  it('attachTab: yalnızca verilen targetId; hedef yoksa null', async () => {
    const ok = setup({ kinds: ['ready'] });
    const tab = await (await ok.source.connect()).attachTab('T1');
    expect(tab?.targetId).toBe('T1');
    expect(await tab!.currentKind()).toBe('ready');
    expect(ok.t.sent.map((m) => m.method)).toEqual(['Target.getTargetInfo', 'Target.attachToTarget', 'Runtime.evaluate']);

    const missing = setup({ infoMissing: true });
    expect(await (await missing.source.connect()).attachTab('GONE')).toBeNull();
  });

  it('close: sekmeyi kapatır; session.close bağlantıyı kapatır', async () => {
    const { t, client, source } = setup({});
    const session = await source.connect();
    const tab = await session.openTab();
    await tab.close();
    expect(t.sent.at(-1)).toMatchObject({ method: 'Target.closeTarget', params: { targetId: 'T1' } });
    await session.close();
    expect(client.closed).toBe(true);
  });
});
