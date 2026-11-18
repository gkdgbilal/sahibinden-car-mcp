import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadBrowserConfig } from '../../src/browser/browser-config.js';
import { RateLimiter } from '../../src/browser/rate-limiter.js';

let dir: string;
let statePath: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sah-rl-'));
  statePath = path.join(dir, 'browser-state.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function clock(start = 1_000_000) {
  const c = { t: start, sleeps: [] as number[] };
  return {
    c,
    now: () => c.t,
    sleep: async (ms: number) => {
      c.sleeps.push(ms);
      c.t += ms;
    },
  };
}
const limiter = (ck: ReturnType<typeof clock>, o: Partial<{ minDelayMs: number; hourlyCap: number }> = {}) =>
  new RateLimiter({
    statePath,
    minDelayMs: o.minDelayMs ?? 5000,
    hourlyCap: o.hourlyCap ?? 30,
    challengeCooldownMs: 60_000,
    now: ck.now,
    sleep: ck.sleep,
  });

describe('RateLimiter', () => {
  it('ilk acquire beklemez; ikinci 1 sn sonra 4000 ms uyur', async () => {
    const ck = clock();
    const l = limiter(ck);
    await l.acquire();
    expect(ck.c.sleeps).toEqual([]);
    ck.c.t += 1000;
    await l.acquire();
    expect(ck.c.sleeps).toEqual([4000]);
  });

  it('aralık dolmuşsa uyumaz', async () => {
    const ck = clock();
    const l = limiter(ck);
    await l.acquire();
    ck.c.t += 5000;
    await l.acquire();
    expect(ck.c.sleeps).toEqual([]);
  });

  it('config minDelayMs asla 5000 altına inmez', () => {
    expect(loadBrowserConfig({ SAHIBINDEN_BROWSER_DELAY_MS: '1' }, dir).minDelayMs).toBe(5000);
  });

  it('süreçler arası: iki ayrı örnek aynı dosyayı paylaşır', async () => {
    const ck = clock();
    const a = limiter(ck);
    const b = limiter(ck);
    await a.acquire();
    await b.acquire();
    expect(ck.c.sleeps).toEqual([5000]);
    await a.acquire();
    expect(ck.c.sleeps).toEqual([5000, 5000]);
  });

  it('saatlik sınır: 30 gezinme sonrası 31. hourly-cap + nextAllowedAt', async () => {
    const ck = clock();
    const l = limiter(ck);
    const first = ck.c.t;
    for (let i = 0; i < 30; i++) await l.acquire();
    await expect(l.acquire()).rejects.toMatchObject({
      code: 'hourly-cap',
      nextAllowedAt: first + 3_600_000,
    });
    expect(l.snapshot()).toMatchObject({ pagesLastHour: 30, nextAllowedAt: first + 3_600_000 });
    ck.c.t = first + 3_600_001;
    await expect(l.acquire()).resolves.toBeUndefined();
  });

  it('sınır yapılandırılabilir (hourlyCap=2)', async () => {
    const ck = clock();
    const l = limiter(ck, { hourlyCap: 2 });
    await l.acquire();
    await l.acquire();
    await expect(l.acquire()).rejects.toMatchObject({ code: 'hourly-cap' });
  });

  it('challenge kaydı: bekleyen doğrulama + 60 sn bekleme uygulanır', async () => {
    const ck = clock();
    const l = limiter(ck);
    await l.acquire();
    l.recordChallenge('https://www.sahibinden.com/x', 'T1');
    expect(l.pendingChallenge()).toMatchObject({ url: 'https://www.sahibinden.com/x', targetId: 'T1' });
    ck.c.t += 10_000;
    await l.acquire();
    expect(ck.c.sleeps).toEqual([50_000]);
  });

  it('clearChallenge: kayıt silinir, bekleme doğrulama tespitinden itibaren 60 sn sürer', async () => {
    const ck = clock();
    const l = limiter(ck);
    l.recordChallenge('https://www.sahibinden.com/x', 'T1');
    ck.c.t += 300_000; // kullanıcı doğrulamayı sonradan geçti
    l.clearChallenge();
    expect(l.pendingChallenge()).toBeNull();
    await l.acquire();
    expect(ck.c.sleeps).toEqual([60_000]);
  });

  it('jitter yok: aynı girdi aynı bekleme', async () => {
    const run = async () => {
      fs.rmSync(statePath, { force: true });
      const ck = clock();
      const l = limiter(ck);
      await l.acquire();
      ck.c.t += 1234;
      await l.acquire();
      ck.c.t += 77;
      await l.acquire();
      return ck.c.sleeps;
    };
    const a = await run();
    const b = await run();
    expect(a).toEqual(b);
    expect(a).toEqual([5000 - 1234, 5000 - 77]);
  });

  it('bozuk durum dosyası boş durum sayılır; yazım atomik (.tmp kalmaz)', async () => {
    fs.writeFileSync(statePath, '{bozuk');
    const ck = clock();
    await limiter(ck).acquire();
    expect(JSON.parse(fs.readFileSync(statePath, 'utf8')).navigations).toHaveLength(1);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
