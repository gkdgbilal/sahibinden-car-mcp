import { describe, expect, it } from 'vitest';
import {
  computeMarketStats, confidenceOf, damageGroupOf, fitSlopes, adjustedPrice, positionOf, tramerBucketOf,
} from '../src/analytics/market.js';
import type { MarketInput } from '../src/analytics/market.js';
import { describe as describeDist } from '../src/analytics/stats.js';
import type { RecordView } from '../src/store/schema.js';
import { NOW, ob, searchInfo } from './helpers/views.js';
import {
  baseInput, isoDaysAgo, lcg, modelPrice, ORIGINAL, PAINTED, row, syntheticMarket,
} from './helpers/synthetic-market.js';

const SEG = { category: 'opel-astra-1.3-cdti' };
const T = { year: 2011, km: 188000 };
const run = (views: RecordView[], o: Partial<MarketInput> = {}, searches = {}, targetView?: RecordView) =>
  computeMarketStats(views, searches, baseInput({ segment: SEG, target: T, ...o }), NOW, targetView ? { targetView } : {});

/** Bir kümenin gözlemlerine arama kanıtı ekler. */
const tag = (views: RecordView[], searchKey: string, filters?: Array<'unpainted' | 'noReplaced'>): RecordView[] =>
  views.map((v) => ({ ...v, observations: v.observations.map((o) => ({ ...o, searchKey, ...(filters ? { filters } : {}) })) }));

describe('Astra benzeri sentetik veri (120 ilan, 2010-2012, 120-280 bin km)', () => {
  const views = syntheticMarket({ n: 120 });

  it('km ve yıl eğimleri işaret ve büyüklükte gerçek modeli yakalar; adjusted + high', () => {
    const r = run(views, { damagePolicy: 'any' });
    expect(r.method.basis).toBe('adjusted');
    expect(r.method.kmSlopePctPer10k).toBeLessThan(0);
    expect(r.method.kmSlopePctPer10k!).toBeGreaterThan(-1.5);
    expect(r.method.kmSlopePctPer10k!).toBeLessThan(-0.9);
    expect(r.method.yearSlopePct!).toBeGreaterThan(4.5);
    expect(r.method.yearSlopePct!).toBeLessThan(7.5);
    expect(r.method.kmPairs).toBeGreaterThan(MIN_PAIRS);
    expect(r.method.yearPairs).toBeGreaterThan(MIN_PAIRS);
    expect(r.confidence.level).toBe('high');
    expect(r.confidence.summary).toMatch(/^n=\d+, yüksek güven/);
    expect(r.method.steps.length).toBeGreaterThanOrEqual(4);
    for (const s of r.method.steps) expect(s.trim().endsWith('.')).toBe(true);
    // hedefe taşınmış medyan: 2011 / 188 bin km için model fiyatı
    const truth = modelPrice(2011, 188000);
    expect(Math.abs(r.target!.fairBand!.median / truth - 1)).toBeLessThan(0.03);
    expect(r.target!.fairBand!.p10!).toBeLessThan(r.target!.fairBand!.q1!);
    expect(r.target!.fairBand!.q3!).toBeLessThan(r.target!.fairBand!.p90!);
    expect(r.warnings[0]).toContain('istek');
    expect(r.warnings[1]).toContain('kaydettiğiniz');
  });

  it('düzeltme işareti ve büyüklüğü: daha çok km -> daha düşük bant; daha yeni yıl -> daha yüksek bant', () => {
    const base = run(views, { damagePolicy: 'any' }).target!.fairBand!.median;
    const highKm = run(views, { damagePolicy: 'any', target: { year: 2011, km: 250000 } }).target!.fairBand!.median;
    const lowKm = run(views, { damagePolicy: 'any', target: { year: 2011, km: 130000 } }).target!.fairBand!.median;
    expect(highKm).toBeLessThan(base);
    expect(lowKm).toBeGreaterThan(base);
    // 62 bin km fark -> yaklaşık %-7,2 (exp(-0.01207 * 6.2)); eğim tahmini gürültülü olduğundan geniş tolerans
    expect(highKm / base).toBeGreaterThan(0.89);
    expect(highKm / base).toBeLessThan(0.96);
    const y2012 = run(views, { damagePolicy: 'any', target: { year: 2012, km: 188000 } }).target!.fairBand!.median;
    const y2010 = run(views, { damagePolicy: 'any', target: { year: 2010, km: 188000 } }).target!.fairBand!.median;
    expect(y2012 / base).toBeGreaterThan(1.03);
    expect(y2012 / base).toBeLessThan(1.09);
    expect(y2010 / base).toBeLessThan(0.97);
    expect(y2010 / base).toBeGreaterThan(0.91);
  });

  it('düzeltilmiş emsalde fazla km\'li ilanın fiyatı yukarı taşınır (adjustedPrice > price)', () => {
    const r = run(views, { damagePolicy: 'any', comparables: 5 });
    expect(r.comparables).toHaveLength(5);
    for (const c of r.comparables) {
      expect(c.adjustedPrice).not.toBeNull();
      if (c.km! > 188000 && c.year! === 2011) expect(c.adjustedPrice!).toBeGreaterThan(c.price);
      if (c.km! < 188000 && c.year! === 2011) expect(c.adjustedPrice!).toBeLessThan(c.price);
    }
    const dist = r.comparables.map((c) => Math.abs(c.year! - 2011) * 30000 + Math.abs(c.km! - 188000));
    expect(dist).toEqual([...dist].sort((a, b) => a - b));
    expect(computeMarketStats(views, {}, baseInput({ segment: SEG, target: T, damagePolicy: 'any', comparables: 0 }), NOW).comparables).toEqual([]);
  });

  it('5. uç aykırı (71.000 TL) elenir ve eğimleri değiştirmez', () => {
    const clean = run(views, { damagePolicy: 'any' });
    const bad = row('2999999999', { year: 2011, km: 190000, price: 71000 });
    const withBad = run([...views, bad], { damagePolicy: 'any' });
    expect(withBad.sample.excluded.outlier + withBad.sample.excluded.implausible).toBe(1);
    expect(withBad.method.kmSlopePctPer10k!).toBeCloseTo(clean.method.kmSlopePctPer10k!, 1);
    expect(withBad.method.yearSlopePct!).toBeCloseTo(clean.method.yearSlopePct!, 1);
  });

  it('6. TL dışı 2 ilan sayılır; 70 günlük gözlem stale; 25 bin TL altı implausible', () => {
    const extra = [
      row('2999999991', { year: 2011, km: 190000, price: 17000, currency: 'EUR' }),
      row('2999999992', { year: 2011, km: 191000, price: 17500, currency: 'USD' }),
      row('2999999993', { year: 2011, km: 192000, price: 760000, at: isoDaysAgo(70) }),
      row('2999999994', { year: 2011, km: 193000, price: 24000 }),
      row('2999999995', { year: 2011, km: 194000, price: null }),
    ];
    const r = run([...views, ...extra], { damagePolicy: 'any' });
    expect(r.sample.excluded).toMatchObject({ otherCurrency: 2, stale: 1, implausible: 1, noPrice: 1 });
    expect(r.sample.candidates).toBe(125);
    expect(run([...views, ...extra], { damagePolicy: 'any', maxAgeDays: 90 }).sample.excluded.stale).toBe(0);
  });

  it('7. aynı (yıl, km, fiyat) üçlüsü: en yeni görülen kalır, kopya sayılır', () => {
    const a = row('2999999981', { year: 2011, km: 190000, price: 750000, at: isoDaysAgo(10) });
    const b = row('2999999982', { year: 2011, km: 190000, price: 750000, at: isoDaysAgo(2) });
    const r = run([...views, a, b], { damagePolicy: 'any' });
    expect(r.sample.excluded.duplicate).toBe(1);
  });

  it('15. determinizm: aynı girdi + aynı now -> aynı çıktı; girdi değişmez', () => {
    const snap = JSON.stringify(views);
    expect(JSON.stringify(run(views))).toBe(JSON.stringify(run(views)));
    expect(JSON.stringify(views)).toBe(snap);
  });

  it('(b) kendi aracı: hatasız emsal bandı; (a) ilan konumu: tipik aralıkta, kesin hüküm dili yok', () => {
    const clean = tag(views, 'k-clean', ['unpainted', 'noReplaced']);
    const b = run(clean, { target: { year: 2011, km: 188000, damage: 'clean', trim: '111. Yıl' } });
    expect(b.sample.damageEvidence.searchFilter).toBe(b.sample.used);
    expect(b.sample.damagePolicyFallback).toBe(false);
    expect(b.target!.fairBand).not.toBeNull();
    expect(b.target!.position).toBeNull(); // fiyat yok
    expect(b.sameTrim).toEqual({ trim: '111. Yıl', n: 0, median: null });
    expect(b.confidence.level).toBe('high');

    const cand = row('2888888888', { year: 2010, km: 230000, price: 690000, damage: ORIGINAL });
    const a = run([...clean, cand], { target: undefined, segment: SEG }, {}, cand);
    expect(a.target!.source).toBe('ref');
    expect(a.target!.damage).toBe('clean');
    expect(a.sample.candidates).toBe(120); // hedef adaylardan çıkarıldı
    const pos = a.target!.position!;
    expect(pos.band).toBe('typical');
    expect(Math.abs(pos.vsMedianPct)).toBeLessThan(6);
    expect(pos.percentile).toBeGreaterThan(25);
    expect(pos.percentile).toBeLessThan(75);
    expect(pos.text).toMatch(/yaklaşık %\d+/);
    expect(pos.text).not.toMatch(/ucuz|pahalı|kaçır|fırsat/i);
  });

  it('13. price_asc sıralı tek sayfa: coverage satırı, güven bir seviye düşer, uyarı', () => {
    const tagged = tag(views, 'k1');
    const searches = { k1: searchInfo({ sorting: 'price_asc', totalCount: 900 }) };
    const noCov = run(tag(views, 'k1'), { damagePolicy: 'any' }, { k1: searchInfo({ sorting: 'date_desc', totalCount: 900 }) });
    const cov = run(tagged, { damagePolicy: 'any' }, searches);
    expect(noCov.confidence.level).toBe('high');
    expect(cov.confidence.level).toBe('medium');
    expect(cov.sample.coverage).toEqual([{ searchKey: 'k1', seen: 120, totalCount: 900, sorting: 'price_asc' }]);
    expect(cov.warnings.join(' ')).toContain('ucuz uca kayık');
    expect(cov.confidence.reasons.join(' ')).toContain('kapsama');
  });

  it('eski gözlemler (yaş medyanı > 30 gün) güveni düşürür ve enflasyon uyarısı verir', () => {
    // Son görülme = gözlem zamanı ile kaydın capturedAt'inin en yenisi; ikisi de eskitilir.
    const old = syntheticMarket({ n: 120, maxAgeDays: 1 }).map((v, i) => {
      const at = isoDaysAgo(35 + (i % 5));
      return { ...v, best: { ...v.best, capturedAt: at }, observations: v.observations.map((o) => ({ ...o, at })) };
    });
    const r = run(old, { damagePolicy: 'any' });
    expect(r.confidence.level).toBe('medium');
    expect(r.sample.observationAgeDays.median).toBeGreaterThan(30);
    expect(r.warnings.join(' ')).toContain('enflasyon');
  });

  it('geniş dağılım (iqrPct > 30) güveni düşürür', () => {
    const wide = syntheticMarket({ n: 120, noise: 0.45 });
    const r = run(wide, { damagePolicy: 'any', adjust: 'none' });
    expect(r.basisDistribution!.iqrPct!).toBeGreaterThan(30);
    expect(r.confidence.reasons.join(' ')).toContain('dağılım geniş');
  });
});

const MIN_PAIRS = 10;

describe('11. makul olmayan eğim kapatılır, sessizce kırpılmaz', () => {
  it('pozitif km eğimi -> km düzeltmesi kapalı + uyarı', () => {
    const rnd = lcg(11);
    const views: RecordView[] = [];
    for (let i = 0; i < 90; i++) {
      const year = 2010 + Math.floor(rnd() * 3);
      const km = 120000 + Math.round(rnd() * 140) * 1000;
      const price = Math.round(800000 * 1.06 ** (year - 2011) * 1.012 ** ((km - 150000) / 10000) * (1 + (rnd() * 2 - 1) * 0.01));
      views.push(row(String(2100000000 + i), { year, km, price }));
    }
    const r = run(views, { damagePolicy: 'any' });
    expect(r.method.kmSlopePctPer10k).toBeNull();
    expect(r.warnings.join(' ')).toContain('Km düzeltmesi kapatıldı');
    expect(r.method.kmPairs).toBeGreaterThan(MIN_PAIRS);
  });

  it('fitSlopes: yıl tek değerliyse yıl düzeltmesi kapalı; çift yoksa km kapalı', () => {
    const rnd = lcg(5);
    const rows = Array.from({ length: 30 }, () => {
      const km = 120000 + Math.round(rnd() * 140) * 1000;
      return { year: 2011, km, price: modelPrice(2011, km, (rnd() * 2 - 1) * 0.01) };
    });
    const f = fitSlopes(rows, 188000);
    expect(f.bKm).not.toBeNull();
    expect(f.bKm! * 10000).toBeLessThan(0);
    expect(f.bYear).toBeNull();
    expect(f.warnings.join(' ')).toContain('Model yılı düzeltmesi kapatıldı');
    const few = fitSlopes(rows.slice(0, 3), 188000);
    expect(few.bKm).toBeNull();
    expect(few.warnings.join(' ')).toContain('Km düzeltmesi kapatıldı');
  });

  it('adjustedPrice: işaret ve büyüklük', () => {
    const fit = { bKm: Math.log(0.988) / 10000, bYear: Math.log(1.06) };
    const up = adjustedPrice({ price: 700000, year: 2011, km: 210000 }, fit, { year: 2011, km: 188000 });
    expect(up / 700000).toBeCloseTo(0.988 ** -2.2, 6);
    const older = adjustedPrice({ price: 700000, year: 2010, km: 188000 }, fit, { year: 2011, km: 188000 });
    expect(older / 700000).toBeCloseTo(1.06, 6);
    expect(adjustedPrice({ price: 1, year: 2011, km: 1 }, { bKm: null, bYear: null }, { year: 2012, km: 9 })).toBe(1);
  });
});

describe('sınır durumları: küçük ve boş örnek, tek ilan', () => {
  const near = (n: number, ids = 2200000000) =>
    Array.from({ length: n }, (_, i) =>
      row(String(ids + i), { year: 2011, km: 180000 + i * 3000, price: 750000 - i * 5000, at: isoDaysAgo(1 + i) }),
    );

  it('8. n=7 -> dar bant, düşük güven, özet n=7 içerir', () => {
    const r = run(near(7), { damagePolicy: 'any' });
    expect(r.method.basis).toBe('narrow-band');
    expect(r.confidence.level).toBe('low');
    expect(r.confidence.summary).toContain('n=7');
    expect(r.sample.used).toBe(7);
    expect(r.target!.fairBand!.q1).not.toBeNull();
    expect(r.method.window).toEqual({ years: 1, km: 30000 });
  });

  it('8. n=3 -> insufficient, konum yok, fairBand yalnız medyan; n=1 ve n=0', () => {
    const r3 = run(near(3), { damagePolicy: 'any', target: { ...T, price: 700000 } });
    expect(r3.confidence.level).toBe('insufficient');
    expect(r3.confidence.summary).toContain('n=3');
    expect(r3.target!.position).toBeNull();
    expect(r3.target!.fairBand).toEqual({ p10: null, q1: null, median: 745000, q3: null, p90: null });
    expect(r3.raw).toMatchObject({ n: 3, q1: null });

    const r1 = run(near(1), { damagePolicy: 'any', target: { ...T, price: 700000 } });
    expect(r1.confidence.level).toBe('insufficient');
    expect(r1.target!.position).toBeNull();
    expect(r1.target!.fairBand!.median).toBe(750000);

    const r0 = run([], { damagePolicy: 'any', target: { ...T, price: 700000 } });
    expect(r0.raw).toBeNull();
    expect(r0.basisDistribution).toBeNull();
    expect(r0.target!.fairBand).toBeNull();
    expect(r0.target!.position).toBeNull();
    expect(r0.confidence.level).toBe('insufficient');
    expect(r0.sample.candidates).toBe(0);
    expect(r0.warnings.join(' ')).toContain('Segmentte ilan yok');
  });

  it('hedefe yakın emsal yok: ham segment dağılımı raporlanır, bant/konum verilmez, güven insufficient', () => {
    const far = Array.from({ length: 10 }, (_, i) => row(String(2300000000 + i), { year: 2010, km: 300000 + i * 1000, price: 600000 + i * 1000 }));
    const r = run(far, { damagePolicy: 'any', target: { ...T, price: 700000 } });
    expect(r.method.basis).toBe('raw-segment');
    expect(r.raw!.n).toBe(10);
    expect(r.basisDistribution).toBeNull();
    expect(r.target!.fairBand).toBeNull();
    expect(r.target!.position).toBeNull();
    expect(r.confidence.level).toBe('insufficient');
    expect(r.confidence.summary).toContain('hedefe yakın emsal yok');
    expect(r.comparables).toEqual([]);
  });

  it('hedefsiz segment istatistiği: ham dağılım, n\'ye göre güven; segment da yoksa hata', () => {
    const r = computeMarketStats(near(10), {}, baseInput({ segment: SEG }), NOW);
    expect(r.target).toBeNull();
    expect(r.method.basis).toBe('raw-segment');
    expect(r.raw!.n).toBe(10);
    expect(r.confidence.level).toBe('medium');
    expect(() => computeMarketStats(near(3), {}, baseInput(), NOW)).toThrow(/segment/);
    expect(() => computeMarketStats(near(3), {}, baseInput({ segment: {} }), NOW)).toThrow(/segment/);
    expect(() => computeMarketStats(near(3), {}, baseInput({ target: T }), NOW)).toThrow(/segment/);
  });

  it('tek ilan segmentte kendisi hedefse adaylardan çıkarılır (n=0)', () => {
    const only = near(1);
    const r = computeMarketStats(only, {}, baseInput({ segment: SEG }), NOW, { targetView: only[0]! });
    expect(r.sample.candidates).toBe(0);
    expect(r.confidence.level).toBe('insufficient');
    expect(r.target!.id).toBe(only[0]!.id);
  });

  it('TL dışı hedef ilan: konum hesaplanmaz, uyarı (hata değil)', () => {
    const eur = row('2400000001', { year: 2011, km: 188000, price: 20000, currency: 'EUR' });
    const r = computeMarketStats([...near(12), eur], {}, baseInput({ segment: SEG, damagePolicy: 'any' }), NOW, { targetView: eur });
    expect(r.target!.price).toBeNull();
    expect(r.target!.position).toBeNull();
    expect(r.warnings.join(' ')).toContain('TL dışı');
  });

  it('hedefin yıl/km bilgisi yoksa güven en fazla low, konum yok', () => {
    const t = row('2400000002', { year: null, km: null, price: 700000 });
    const r = computeMarketStats([...near(40), t], {}, baseInput({ segment: SEG, damagePolicy: 'any' }), NOW, { targetView: t });
    expect(r.confidence.level).toBe('low');
    expect(r.target!.position).toBeNull();
    expect(r.target!.fairBand).toBeNull();
  });
});

describe('hasar politikası ve ayrı tablolar (düzeltmeye girmez)', () => {
  const cleanSet = (n: number, base = 2500000000) =>
    Array.from({ length: n }, (_, i) =>
      row(String(base + i), {
        year: 2011, km: 170000 + i * 1500, price: modelPrice(2011, 170000 + i * 1500, (i % 5) * 0.002),
        filters: ['unpainted', 'noReplaced'], searchKey: 'kfilt',
      }),
    );
  const paintedSet = (n: number, base = 2600000000) =>
    Array.from({ length: n }, (_, i) =>
      row(String(base + i), {
        year: 2011, km: 172000 + i * 1500, price: Math.round(modelPrice(2011, 172000 + i * 1500) * 0.93), damage: PAINTED,
      }),
    );

  it('9. 20 arama-kanıtlı temiz + 5 detay boyalı: boyalılar damageMismatch, ayrı satır', () => {
    const r = run([...cleanSet(20), ...paintedSet(5)], { target: { ...T, damage: 'clean' } });
    expect(r.sample.excluded.damageMismatch).toBe(5);
    expect(r.sample.damagePolicyFallback).toBe(false);
    const clean = r.damageBreakdown.find((g) => g.group === 'clean')!;
    const painted = r.damageBreakdown.find((g) => g.group === 'painted')!;
    expect(clean).toMatchObject({ n: 20, evidence: { detail: 0, searchFilter: 20 }, vsCleanMedianPct: null });
    expect(painted).toMatchObject({ n: 5, evidence: { detail: 5, searchFilter: 0 } });
    expect(painted.vsCleanMedianPct!).toBeLessThan(-4);
    expect(painted.vsCleanMedianPct!).toBeGreaterThan(-10);
    expect(r.sample.damageEvidence).toEqual({ detail: 0, searchFilter: r.sample.used, none: 0 });
    // fiyat bandı yalnızca temizlerden; boyalı fark bantta yok
    expect(r.target!.fairBand!.median).toBeGreaterThan(painted.median!);
    expect(r.warnings.join(' ')).toContain('satıcı beyanına dayanır');
  });

  it('9. temiz n < minSample: bilinmeyenler eklenir, damagePolicyFallback, güven bir seviye düşer, uyarı', () => {
    const unknown = Array.from({ length: 12 }, (_, i) =>
      row(String(2700000000 + i), { year: 2011, km: 175000 + i * 1500, price: modelPrice(2011, 175000 + i * 1500, (i % 4) * 0.003) }),
    );
    const withFallback = run([...cleanSet(4), ...unknown], { target: { ...T, damage: 'clean' } });
    expect(withFallback.sample.damagePolicyFallback).toBe(true);
    expect(withFallback.sample.excluded.damageMismatch).toBe(0);
    expect(withFallback.warnings.join(' ')).toContain('Hasar bilgisi bilinmeyen ilanlar dahil edildi');
    expect(withFallback.confidence.reasons.join(' ')).toContain('hasar bilgisi bilinmeyen');
    // aynı örneklem (n=16, medium) fallback'siz olsaydı medium kalırdı: bir seviye düştü
    const noFallback = run([...cleanSet(4), ...unknown], { damagePolicy: 'any', target: { ...T, damage: 'clean' } });
    expect(noFallback.confidence.level).toBe('medium');
    expect(withFallback.confidence.level).toBe('low');
  });

  it('hedef hasar grubu bilinmiyorsa any + uyarı; damagePolicy clean açık seçimdir', () => {
    const views = [...cleanSet(10), ...paintedSet(10)];
    const unknownTarget = run(views);
    expect(unknownTarget.sample.excluded.damageMismatch).toBe(0);
    expect(unknownTarget.warnings.join(' ')).toContain('Hedefin hasar durumu bilinmiyor');
    const cleanOnly = run(views, { damagePolicy: 'clean' });
    expect(cleanOnly.sample.excluded.damageMismatch).toBe(10);
  });

  it('10. detay boyalı + arama boyasız çelişkisi: detay üstün (painted), evidenceConflicts 1', () => {
    const conflicted = row('2800000001', { year: 2011, km: 185000, price: 760000, // fiyat kümeyle uyumlu: aykırı değer olarak elenmesin
      damage: PAINTED, filters: ['unpainted', 'noReplaced'], searchKey: 'kfilt' });
    expect(conflicted.observations[0]!.filters).toEqual(['unpainted', 'noReplaced']);
    const info = damageGroupOf(conflicted, NOW, 60);
    expect(info).toEqual({ group: 'painted', evidence: 'detail', conflict: true });
    const r = run([...cleanSet(10), conflicted], { target: { ...T, damage: 'clean' } });
    expect(r.sample.evidenceConflicts).toBe(1);
    expect(r.damageBreakdown.find((g) => g.group === 'painted')!.n).toBe(1);
    expect(r.damageBreakdown.find((g) => g.group === 'painted')!.median).toBeNull(); // n < 3
  });

  it('damageGroupOf: ağır hasar > değişen > boyalı > temiz; eski arama kanıtı sayılmaz', () => {
    const g = (o: Parameters<typeof row>[1]) => damageGroupOf(row('2900000001', { year: 2011, km: 1, price: 1, ...o }), NOW, 60).group;
    expect(g({ damage: ORIGINAL, heavyDamage: true })).toBe('heavy');
    expect(g({ damage: [{ part: 'kaput', status: 'changed' }, { part: 'tavan', status: 'painted' }] })).toBe('replaced');
    expect(g({ damage: [{ part: 'kaput', status: 'local-painted' }] })).toBe('painted');
    expect(g({ damage: ORIGINAL, heavyDamage: false })).toBe('clean');
    expect(g({ damage: null, heavyDamage: null, tramerStatus: 'none' })).toBe('unknown');
    expect(g({})).toBe('unknown');
    expect(g({ filters: ['unpainted', 'noReplaced'], searchKey: 'k' })).toBe('clean');
    expect(g({ filters: ['unpainted'], searchKey: 'k' })).toBe('unknown');
    expect(g({ filters: ['unpainted', 'noReplaced'], searchKey: 'k', at: isoDaysAgo(90) })).toBe('unknown');
  });

  it('tramer tablosu yalnızca detay kayıtlarından; n < 3 satırda medyan null', () => {
    const t = (i: number, o: Parameters<typeof row>[1]) => row(String(3000000000 + i), { year: 2011, km: 180000, price: 700000 + i * 1000, ...o });
    const views = [
      ...Array.from({ length: 4 }, (_, i) => t(i, { tramerStatus: 'none', damage: ORIGINAL })),
      t(10, { tramerStatus: 'amount', tramerAmount: 12000, damage: ORIGINAL }),
      t(11, { tramerStatus: 'amount', tramerAmount: 60000, damage: ORIGINAL }),
      t(12, { tramerStatus: 'amount', tramerAmount: 150000, damage: ORIGINAL }),
      t(13, { tramerStatus: 'mentioned', damage: ORIGINAL }),
      t(14, {}), // özet kaydı -> tabloya girmez
    ];
    const rows = Object.fromEntries(
      computeMarketStats(views, {}, baseInput({ segment: SEG, damagePolicy: 'any' }), NOW).tramerBreakdown.map((b) => [b.bucket, b]),
    );
    expect(rows['none']).toMatchObject({ n: 4 });
    expect(rows['none']!.median).not.toBeNull();
    expect(rows['≤25 bin']).toEqual({ bucket: '≤25 bin', n: 1, median: null });
    expect(rows['25–100 bin']!.n).toBe(1);
    expect(rows['>100 bin']!.n).toBe(1);
    expect(rows['mentioned']!.n).toBe(1);
    expect(rows['unknown']).toBeUndefined();
    expect(tramerBucketOf(views[8]!)).toBeNull();
  });
});

describe('confidenceOf ve positionOf', () => {
  const base = { n: 30, medianAgeDays: 5, damagePolicyFallback: false, iqrPct: 10, narrowBandOffCenter: false, lowCoverage: false, noTargetYearKm: false };
  it('n eşikleri: <5 insufficient, 5-9 low, 10-24 medium, >=25 high', () => {
    const lv = (n: number) => confidenceOf({ ...base, n }).level;
    expect([lv(0), lv(4), lv(5), lv(9), lv(10), lv(24), lv(25)]).toEqual(['insufficient', 'insufficient', 'low', 'low', 'medium', 'medium', 'high']);
  });
  it('her düşürme bir seviye; en düşük low; insufficient düşmez', () => {
    expect(confidenceOf({ ...base, medianAgeDays: 40 }).level).toBe('medium');
    expect(confidenceOf({ ...base, medianAgeDays: 40, iqrPct: 50 }).level).toBe('low');
    expect(confidenceOf({ ...base, medianAgeDays: 40, iqrPct: 50, lowCoverage: true, damagePolicyFallback: true }).level).toBe('low');
    expect(confidenceOf({ ...base, n: 3, lowCoverage: true }).level).toBe('insufficient');
    expect(confidenceOf({ ...base, narrowBandOffCenter: true }).level).toBe('medium');
    expect(confidenceOf({ ...base, noTargetYearKm: true }).level).toBe('low');
    expect(confidenceOf({ ...base, n: 7 }).summary).toBe('n=7, düşük güven: örnek az (n<10); gözlem yaşı medyanı 5 gün');
  });
  it('position: orta-sıra yüzdelik, medyana göre %, bant sınırları', () => {
    const values = Array.from({ length: 101 }, (_, i) => 600000 + i * 1000); // 600k..700k
    const d = describeDist(values);
    const at = (p: number) => positionOf(values, d, p)!;
    expect(at(650000)).toMatchObject({ percentile: 50, vsMedianPct: 0, band: 'typical' });
    expect(at(650000).text).toContain('medyanla aynı düzeyde');
    expect(at(690000)).toMatchObject({ band: 'above' });
    expect(at(690000).text).toContain('medyanın %6,2 üstünde');
    expect(at(600000).band).toBe('well-below');
    expect(at(603000).band).toBe('well-below');
    expect(at(608000).band).toBe('well-below'); // P10 = 610000 (quantile7)
    expect(at(612000).band).toBe('below'); // P10 ile Q1 (625000) arası
    expect(at(700000)).toMatchObject({ band: 'well-above', percentile: 100 }); // orta-sıra 99,5 -> tam sayıya yuvarlanır
    expect(positionOf([1, 2, 3, 4], describeDist([1, 2, 3, 4]), 2)).toBeNull();
  });
});

describe('uyumsuz yardımcılar', () => {
  it('ob yardımcısı kullanılıyor (tip kontrolü)', () => {
    expect(ob(1, '2026-11-01').kind).toBe('search');
  });
});
