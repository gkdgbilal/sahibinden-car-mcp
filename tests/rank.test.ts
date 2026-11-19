import { describe, expect, it } from 'vitest';
import { rankListings } from '../src/analytics/rank.js';
import type { RecordView } from '../src/store/schema.js';
import { NOW } from './helpers/views.js';
import { isoDaysAgo, modelPrice, ORIGINAL, PAINTED, row, syntheticMarket } from './helpers/synthetic-market.js';

const OPTS = { top: 5, maxAgeDays: 30 };
const Q = { brand: 'Opel', models: ['Astra'] };
const market = (n = 60) => syntheticMarket({ n, noise: 0.02 });

/** Detaylı (hasar bilgili) tek ilan; modelPrice'a göre `pct` kadar sapmış fiyatla. */
const detailed = (id: string, pct: number, o: Partial<Parameters<typeof row>[1]> = {}, desc?: string): RecordView => {
  const year = o.year ?? 2011;
  const km = o.km ?? 180000;
  const v = row(id, { year, km, price: Math.round(modelPrice(year, km) * (1 + pct / 100)), damage: ORIGINAL, heavyDamage: false, ...o });
  return desc === undefined ? v : { ...v, best: { ...v.best, description: desc } as RecordView['best'] };
};
const find = (r: ReturnType<typeof rankListings>, id: string) => [...r.ranked, ...r.avoid].find((x) => x.id === id);

describe('rankListings', () => {
  it('piyasadan ~%12 ucuz, temiz, detaylı ilan 1. sıra ve strong-candidate', () => {
    const r = rankListings([...market(), detailed('4000000001', -12)], Q, OPTS, NOW);
    expect(r.ranked[0]!.id).toBe('4000000001');
    expect(r.ranked[0]!.verdict).toBe('strong-candidate');
    expect(r.ranked[0]!.vsMarketPct!).toBeLessThan(-8);
    expect(r.ranked[0]!.vsMarketPct!).toBeGreaterThan(-18);
    expect(r.ranked[0]!.reasons[0]).toContain('ucuz');
    expect(r.ranked.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(r.groups[0]!.confidence).toMatch(/medium|high/);
    expect(r.groups[0]!.kmSlopePctPer10k!).toBeLessThan(0);
  });

  it('aynı fiyatlı ama detayı olmayan ilan, temiz detaylının altında kalır', () => {
    const cheapNoDetail = row('4000000002', { year: 2011, km: 180000, price: Math.round(modelPrice(2011, 180000) * 0.88) });
    const r = rankListings([...market(), cheapNoDetail, detailed('4000000003', -12)], Q, OPTS, NOW);
    const a = find(r, '4000000003')!;
    const b = find(r, '4000000002')!;
    expect(a.score).toBeGreaterThan(b.score);
    expect(b.verdict).toBe('check-first'); // %8'den ucuz ama detay yok
    expect(b.nextSteps.join(' ')).toContain('detay sayfasını');
  });

  it('piyasanın %25+ altı: fırsat değil check-first (şüphe)', () => {
    const r = rankListings([...market(), detailed('4000000004', -40)], Q, OPTS, NOW);
    const x = find(r, '4000000004')!;
    expect(x.verdict).toBe('check-first');
    expect(x.reasons.join(' ')).toContain('çok altında');
  });

  it('piyasadan pahalı: overpriced ve pazarlık adımı', () => {
    const r = rankListings([...market(), detailed('4000000005', +20)], Q, { top: 100, maxAgeDays: 30 }, NOW); // düşük puan: ilk 5'e girmez
    const x = find(r, '4000000005')!;
    expect(x.verdict).toBe('overpriced');
    expect(x.vsMarketPct!).toBeGreaterThan(10);
    expect(x.nextSteps.join(' ')).toContain('Pazarlık');
  });

  it('yüksek riskli (açıklamada motor arızası) ana listede değil, avoid altında', () => {
    const risky = detailed('4000000006', -15, {}, 'Motoru arızalı, acil satılık.');
    const r = rankListings([...market(), risky], Q, OPTS, NOW);
    expect(r.ranked.find((x) => x.id === '4000000006')).toBeUndefined();
    const a = r.avoid.find((x) => x.id === '4000000006')!;
    expect(a.verdict).toBe('risky');
    expect(a.risks.map((f) => f.code)).toContain('engine-fault');
    expect(a.score).toBeLessThan(50);
  });

  it('ağır hasar, yapısal değişen ve yüksek tramer riskli sayılır; boyalı yalnız puan düşürür', () => {
    const rows = [
      detailed('4000000007', -10, { heavyDamage: true }),
      detailed('4000000008', -10, { damage: [{ part: 'Tavan', status: 'changed' }] }),
      detailed('4000000009', -10, { tramerAmount: 200000 }),
      detailed('4000000010', -10, { damage: PAINTED }),
    ];
    const r = rankListings([...market(), ...rows], Q, OPTS, NOW);
    for (const id of ['4000000007', '4000000008', '4000000009']) expect(r.avoid.map((x) => x.id)).toContain(id);
    const p = find(r, '4000000010')!;
    expect(p.verdict).not.toBe('risky');
    expect(p.damage).toBe('painted');
  });

  it('olumsuzlamalı açıklama risk üretmez', () => {
    const r = rankListings([...market(), detailed('4000000011', -12, {}, 'Pert değil, ağır hasar kaydı yoktur. Ekspertiz yaptırılabilir.')], Q, OPTS, NOW);
    const x = find(r, '4000000011')!;
    expect(x.verdict).toBe('strong-candidate');
    expect(x.positives).toContain('Ekspertize açık/raporlu');
  });

  it('emsal yetersizse (n<5) piyasa konumu yok: no-baseline, uyarı, ana listenin sonunda', () => {
    const few = [detailed('4000000012', 0), detailed('4000000013', 0, { km: 175000 }), detailed('4000000014', 0, { km: 170000 })];
    const r = rankListings(few, Q, OPTS, NOW);
    expect(r.ranked.every((x) => x.verdict === 'no-baseline' && x.vsMarketPct === null && x.adjustedPrice === null)).toBe(true);
    expect(r.groups[0]!.confidence).toBe('insufficient');
    expect(r.warnings.join(' ')).toContain('emsal sayısı yetersiz');
  });

  it('düşük güvenli taban (n küçük): gerekçede açık uyarı', () => {
    const few = [...Array.from({ length: 6 }, (_, i) => detailed(`41000000${i}`, 0, { km: 170000 + i * 4000 })), detailed('4100000099', -12)];
    const r = rankListings(few, Q, OPTS, NOW);
    expect(r.groups[0]!.confidence).toBe('low');
    expect(r.ranked[0]!.reasons.join(' ')).toContain('düşük güvenli');
  });

  it('çok modelli arama: gruplar ayrı değerlendirilir', () => {
    const focus = syntheticMarket({ n: 40, noise: 0.02, idBase: 2100000000 }).map((v) => ({
      ...v,
      best: { ...v.best, brand: 'Ford', series: 'Focus', title: 'FORD FOCUS 1.6' } as RecordView['best'],
      observations: v.observations.map((o) => ({ ...o, price: o.price === null ? null : Math.round(o.price * 1.3) })),
    })).map((v) => ({ ...v, best: { ...v.best, price: Math.round((v.best.price ?? 0) * 1.3) } as RecordView['best'] }));
    const r = rankListings([...market(40), ...focus], { models: ['Astra', 'Focus'] }, { top: 20, maxAgeDays: 30 }, NOW);
    expect(r.groups.map((g) => g.group).sort()).toEqual(['Ford Focus', 'Opel Astra']);
    const medians = Object.fromEntries(r.groups.map((g) => [g.group, g.medianAdjustedPrice!]));
    expect(medians['Ford Focus']! / medians['Opel Astra']!).toBeGreaterThan(1.2); // Focus %30 pahalı piyasa, Astra'yı bozmaz
    // Focus ilanı kendi grubuna göre konumlanır: genel olarak ±%12 içinde
    for (const x of r.ranked.filter((y) => y.group === 'Ford Focus')) expect(Math.abs(x.vsMarketPct ?? 0)).toBeLessThan(12);
  });

  it('arama satırı (marka yok) ve detay kaydı (marka var) aynı grupta toplanır', () => {
    const noBrand = market(30).map((v) => ({ ...v, best: { ...v.best, brand: null } as RecordView['best'] }));
    const r = rankListings([...noBrand, detailed('4000000050', -12)], { models: ['Astra'] }, OPTS, NOW);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.group).toBe('Opel Astra'); // etiket, markalı kayıttan
    expect(r.groups[0]!.n).toBeGreaterThanOrEqual(30);
  });

  it('eleme: bayat gözlem, başka para birimi, fiyatsız, filtreye uymayan', () => {
    const stale = row('4000000020', { year: 2011, km: 180000, price: 750000, at: isoDaysAgo(90) });
    const eur = row('4000000021', { year: 2011, km: 180000, price: 15000, currency: 'EUR' });
    const noPrice = row('4000000022', { year: 2011, km: 180000, price: null });
    const r = rankListings([...market(), stale, eur, noPrice], { ...Q, yearMin: 2011 }, OPTS, NOW);
    expect(r.excluded).toMatchObject({ stale: 1, otherCurrency: 1, noPrice: 1 });
    expect(r.excluded.noMatch).toBeGreaterThan(0); // 2010 model ilanlar
    expect([...r.ranked, ...r.avoid].some((x) => ['4000000020', '4000000021', '4000000022'].includes(x.id))).toBe(false);
  });

  it('top sınırı ve deterministik sıra', () => {
    const rows = [...market(), detailed('4000000030', -12)];
    const a = rankListings(rows, Q, { top: 3, maxAgeDays: 30 }, NOW);
    const b = rankListings([...rows].reverse(), Q, { top: 3, maxAgeDays: 30 }, NOW);
    expect(a.ranked).toHaveLength(3);
    expect(a.ranked.map((x) => x.id)).toEqual(b.ranked.map((x) => x.id));
    expect(a.ranked.map((x) => x.score)).toEqual([...a.ranked.map((x) => x.score)].sort((x, y) => y - x));
  });

  it('boş sonuç: uyarı verir, hata atmaz', () => {
    const r = rankListings([], Q, OPTS, NOW);
    expect(r.ranked).toEqual([]);
    expect(r.warnings.join(' ')).toContain('içe aktarın');
  });

  it('daha çok km\'li ilanın fiyatı düzeltilir: yüksek km ucuz görünüp otomatik "fırsat" sayılmaz', () => {
    // 270 bin km'li ilan, modelPrice'ın kendisi kadar fiyatlı => düzeltilmiş fiyat >= ham fiyat
    const highKm = detailed('4000000040', 0, { km: 270000, year: 2011 });
    const r = rankListings([...market(), highKm], Q, OPTS, NOW);
    const x = find(r, '4000000040')!;
    expect(x.adjustedPrice!).toBeGreaterThan(x.price);
    expect(Math.abs(x.vsMarketPct!)).toBeLessThan(6);
  });
});
