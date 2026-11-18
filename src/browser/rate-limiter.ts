import fs from 'node:fs';
import path from 'node:path';
import { BrowserError } from './errors.js';

export interface PendingChallenge {
  url: string;
  targetId: string;
  since: number;
}

export interface LimiterState {
  lastNavigationAt: number | null;
  /** Son 60 dk içindeki gezinme zamanları (epoch ms). */
  navigations: number[];
  pendingChallenge: PendingChallenge | null;
  /** Doğrulama sonrası bekleme: bu ana kadar gezinme yapılmaz. */
  cooldownUntil: number | null;
}

export interface LimiterOptions {
  statePath: string;
  minDelayMs: number;
  hourlyCap: number;
  challengeCooldownMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const HOUR_MS = 3_600_000;

const emptyState = (): LimiterState => ({
  lastNavigationAt: null,
  navigations: [],
  pendingChallenge: null,
  cooldownUntil: null,
});

/**
 * Sabit aralıklı (jitter yok) hız sınırlayıcı. Durum dosyası her çağrıda yeniden okunur, bu yüzden
 * aynı dosyayı paylaşan birden çok süreç/örnek aynı sınırlara tabidir.
 */
export class RateLimiter {
  constructor(private readonly o: LimiterOptions) {}

  private read(): LimiterState {
    try {
      const raw = JSON.parse(fs.readFileSync(this.o.statePath, 'utf8')) as Partial<LimiterState>;
      const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const pc = raw.pendingChallenge;
      return {
        lastNavigationAt: num(raw.lastNavigationAt),
        navigations: Array.isArray(raw.navigations) ? raw.navigations.filter((n): n is number => num(n) !== null) : [],
        pendingChallenge:
          pc && typeof pc.url === 'string' && typeof pc.targetId === 'string' && num(pc.since) !== null
            ? { url: pc.url, targetId: pc.targetId, since: pc.since }
            : null,
        cooldownUntil: num(raw.cooldownUntil),
      };
    } catch {
      return emptyState();
    }
  }

  private write(s: LimiterState): void {
    fs.mkdirSync(path.dirname(this.o.statePath), { recursive: true });
    const tmp = `${this.o.statePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s), 'utf8');
    fs.renameSync(tmp, this.o.statePath);
  }

  private recent(s: LimiterState, now: number): number[] {
    return s.navigations.filter((t) => now - t < HOUR_MS);
  }

  /** Bir sonraki gezinmenin izinli olduğu an (epoch ms); şimdi izinliyse null. */
  private nextAllowed(s: LimiterState, now: number): number | null {
    const recent = this.recent(s, now);
    const capUntil = recent.length >= this.o.hourlyCap ? Math.min(...recent) + HOUR_MS : 0;
    const readyAt = Math.max(
      s.lastNavigationAt === null ? 0 : s.lastNavigationAt + this.o.minDelayMs,
      s.cooldownUntil ?? 0,
      capUntil,
    );
    return readyAt > now ? readyAt : null;
  }

  /** Gezinmeden önce çağrılır: saatlik sınırı denetler, sabit süre bekler, zamanı kaydeder. */
  async acquire(): Promise<void> {
    const s = this.read();
    const now = this.o.now();
    const recent = this.recent(s, now);
    if (recent.length >= this.o.hourlyCap) {
      throw new BrowserError(
        'hourly-cap',
        `Saatlik sayfa sınırına (${this.o.hourlyCap}) ulaşıldı`,
        'Sınır dolana kadar bekleyin (nextAllowedAt).',
        Math.min(...recent) + HOUR_MS,
      );
    }
    const readyAt = Math.max(
      s.lastNavigationAt === null ? 0 : s.lastNavigationAt + this.o.minDelayMs,
      s.cooldownUntil ?? 0,
    );
    const wait = readyAt - now;
    if (wait > 0) await this.o.sleep(wait);
    const at = this.o.now();
    this.write({ ...s, lastNavigationAt: at, navigations: [...recent, at] });
  }

  /** Doğrulama sayfası görüldü: sekme kaydedilir, yeni gezinme için bekleme başlar. */
  recordChallenge(url: string, targetId: string): void {
    const s = this.read();
    const now = this.o.now();
    this.write({
      ...s,
      pendingChallenge: { url, targetId, since: now },
      cooldownUntil: now + this.o.challengeCooldownMs,
    });
  }

  pendingChallenge(): PendingChallenge | null {
    return this.read().pendingChallenge;
  }

  /** Doğrulama bitti (ya da sekme kayboldu): bekleyen kaydı siler; bu andan itibaren bekleme süresi yeniden başlar. */
  clearChallenge(): void {
    const s = this.read();
    this.write({
      ...s,
      pendingChallenge: null,
      cooldownUntil: Math.max(s.cooldownUntil ?? 0, this.o.now() + this.o.challengeCooldownMs),
    });
  }

  snapshot(): { pagesLastHour: number; nextAllowedAt: number | null; pendingChallenge: PendingChallenge | null } {
    const s = this.read();
    const now = this.o.now();
    return {
      pagesLastHour: this.recent(s, now).length,
      nextAllowedAt: this.nextAllowed(s, now),
      pendingChallenge: s.pendingChallenge,
    };
  }
}
