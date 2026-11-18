import { describe, expect, it } from 'vitest';
import { detectDrop, lifecycleNote, lifecycleOf, priceHistoryOf, priceRuns } from '../src/analytics/history.js';
import { NOW, ob, searchInfo, view } from './helpers/views.js';

const OPTS = { withinDays: 30, minDropPct: 3, minDropTl: 0 };
const base = () => view('1', [ob(745000, '2026-10-20'), ob(745000, '2026-11-02'), ob(715000, '2026-11-09')]);

describe('priceRuns', () => {
  it('ardışık aynı fiyat birleşir; sırasız girdi sıralanır; null fiyat atlanır', () => {
    const runs = priceRuns([ob(715000, '2026-11-09'), ob(745000, '2026-10-20'), ob(null, '2026-10-25'), ob(745000, '2026-11-02')]);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ price: 745000, firstAt: '2026-10-20T12:00:00.000Z', lastAt: '2026-11-02T12:00:00.000Z', n: 2 });
    expect(runs[1]).toMatchObject({ price: 715000, n: 1 });
  });
  it('currency süzgeci araya giren başka para birimini yok sayar', () => {
    const o = [ob(700, '2026-11-01'), ob(20, '2026-11-02', { currency: 'EUR' }), ob(700, '2026-11-03')];
    expect(priceRuns(o)).toHaveLength(3);
    expect(priceRuns(o, 'TL')).toHaveLength(1);
  });
});

describe('detectDrop', () => {
  it('1. 745k -> 715k: düşüş, tutar/yüzde ve aralık', () => {
    const r = detectDrop(base(), NOW, OPTS);
    expect(r.outcome).toBe('drop');
    expect(r.drop).toMatchObject({
      currentPrice: 715000, peakPrice: 745000, firstPrice: 745000, dropTl: 30000, dropPct: 4.0, totalChangePct: -4.0,
      pricePoints: 2, reboundDrop: false, flags: [],
      detectedBetween: ['2026-11-02T12:00:00.000Z', '2026-11-09T12:00:00.000Z'],
    });
  });

  it('2. son değişiklik pencereden eskiyse listelenmez', () => {
    expect(detectDrop(base(), NOW, { ...OPTS, withinDays: 5 }).outcome).toBe('none');
    expect(detectDrop(base(), NOW, { ...OPTS, withinDays: 10 }).outcome).toBe('drop'); // 11-09 pencere içinde
  });

  it('3. minDropPct ve minDropTl VE kuralı', () => {
    expect(detectDrop(base(), NOW, { ...OPTS, minDropPct: 4.1 }).outcome).toBe('none');
    expect(detectDrop(base(), NOW, { ...OPTS, minDropPct: 4 }).outcome).toBe('drop');
    expect(detectDrop(base(), NOW, { ...OPTS, minDropTl: 40000 }).outcome).toBe('none');
    expect(detectDrop(base(), NOW, { ...OPTS, minDropTl: 30000 }).outcome).toBe('drop');
  });

  it('4. 700k -> 760k -> 700k: tepe 760k, rebound, net değişim 0', () => {
    const v = view('1', [ob(700000, '2026-10-25'), ob(760000, '2026-11-05'), ob(700000, '2026-11-12')]);
    const d = detectDrop(v, NOW, OPTS).drop!;
    expect(d).toMatchObject({ peakPrice: 760000, firstPrice: 700000, reboundDrop: true, pricePoints: 3 });
    expect(d.totalChangePct).toBe(0);
    expect(d.dropPct).toBeCloseTo(7.9, 1);
  });

  it('5. pencere başında geçerli koşu tepe sayılır', () => {
    const v = view('1', [ob(800000, '2026-09-01'), ob(780000, '2026-11-10')]);
    expect(detectDrop(v, NOW, OPTS).outcome).toBe('none'); // %2,5 < varsayılan %3
    const d = detectDrop(v, NOW, { ...OPTS, minDropPct: 2 }).drop!;
    expect(d.peakPrice).toBe(800000);
    expect(d.dropTl).toBe(20000);
    // Pencere başından önce biten, o anda geçerli olmayan koşu tepe olamaz.
    const v2 = view('2', [ob(900000, '2026-08-01'), ob(800000, '2026-09-01'), ob(780000, '2026-11-10')]);
    expect(detectDrop(v2, NOW, { ...OPTS, minDropPct: 2 }).drop!.peakPrice).toBe(800000);
  });

  it('6. TL dışı son gözlem ayrı sayılır; TL->EUR->TL yalnızca TL ile hesaplanır', () => {
    const eur = view('1', [ob(750000, '2026-10-25'), ob(15000, '2026-11-10', { currency: 'EUR' })]);
    expect(detectDrop(eur, NOW, OPTS)).toMatchObject({ outcome: 'other-currency' });
    const mixed = view('2', [
      ob(750000, '2026-10-25'), ob(15000, '2026-11-02', { currency: 'EUR' }), ob(700000, '2026-11-10'),
    ]);
    const r = detectDrop(mixed, NOW, OPTS);
    expect(r.currencyChanged).toBe(true);
    expect(r.outcome).toBe('drop');
    expect(r.drop).toMatchObject({ peakPrice: 750000, currentPrice: 700000, flags: ['currency-changed'] });
    // EUR düşüş olarak karışmaz: TL->EUR->TL aynı TL fiyat = tek koşu.
    const same = view('3', [ob(750000, '2026-10-25'), ob(15000, '2026-11-02', { currency: 'EUR' }), ob(750000, '2026-11-10')]);
    expect(detectDrop(same, NOW, OPTS)).toMatchObject({ outcome: 'none', currencyChanged: true, runCount: 1 });
    // Para birimi hiç TL değil: fiyat azalsa da düşüş yok.
    const onlyEur = view('4', [ob(20000, '2026-10-25', { currency: 'EUR' }), ob(15000, '2026-11-10', { currency: 'EUR' })]);
    expect(detectDrop(onlyEur, NOW, OPTS).outcome).toBe('other-currency');
  });

  it('9. approx gözlem approximate-dates bayrağı taşır', () => {
    const v = view('1', [ob(745000, '2026-10-20', { approx: true }), ob(715000, '2026-11-09', { approx: true })]);
    expect(detectDrop(v, NOW, OPTS).drop!.flags).toEqual(['approximate-dates']);
    expect(detectDrop(base(), NOW, OPTS).drop!.flags).toEqual([]);
  });

  it('fiyat artışı, tek koşu ve fiyatsız kayıt düşüş değildir', () => {
    expect(detectDrop(view('1', [ob(700000, '2026-10-25'), ob(760000, '2026-11-12')]), NOW, OPTS).outcome).toBe('none');
    expect(detectDrop(view('1', [ob(700000, '2026-10-25')]), NOW, OPTS).outcome).toBe('none');
    expect(detectDrop(view('1', [ob(null, '2026-10-25')]), NOW, OPTS).outcome).toBe('no-price');
  });

  it('sahte düşüş yok: aynı iki gözlem sırasız eklense de sonuç aynı', () => {
    const a = [ob(800000, '2026-11-01'), ob(750000, '2026-11-10')];
    expect(detectDrop(view('1', a), NOW, OPTS).drop!.dropTl).toBe(50000);
    expect(detectDrop(view('1', [...a].reverse()), NOW, OPTS).drop!.dropTl).toBe(50000);
  });
});

describe('lifecycleOf', () => {
  const KEY = '/opel-astra-1.3-cdti?unpaintedParts=true';
  const old = () => view('1', [ob(745000, '2026-10-29', { searchKey: KEY })]); // 20 gün önce
  const lc = (v = old(), s = { [KEY]: searchInfo({ lastObservedAt: '2026-11-15T12:00:00.000Z' }) }) => lifecycleOf(v, s, NOW, 14);

  it('7. aynı arama sonradan kaydedildi -> not-seen-recently, recheckedAt dolu', () => {
    expect(lc()).toMatchObject({
      daysSinceLastSeen: 20, status: 'not-seen-recently', approximate: false, recheckedAt: '2026-11-15T12:00:00.000Z',
      firstSeenAt: '2026-10-29T12:00:00.000Z', lastSeenAt: '2026-10-29T12:00:00.000Z',
    });
  });

  it('7. aynı arama sonradan kaydedilmedi -> not-rechecked', () => {
    const r = lc(old(), { [KEY]: searchInfo({ lastObservedAt: '2026-10-29T12:00:00.000Z' }) });
    expect(r.status).toBe('not-rechecked');
    expect(r.recheckedAt).toBeNull();
  });

  it('7. filtersKnown:false anahtar -> not-rechecked', () => {
    const k = '/opel-astra-1.3-cdti?*';
    const v = view('1', [ob(745000, '2026-10-29', { searchKey: k })]);
    expect(lc(v, { [k]: searchInfo({ filtersKnown: false }) }).status).toBe('not-rechecked');
  });

  it('yalnızca detay gözlemi / bilinmeyen anahtar -> not-rechecked', () => {
    expect(lc(view('1', [ob(745000, '2026-10-29', { kind: 'listing' })]), {}).status).toBe('not-rechecked');
    expect(lc(old(), {}).status).toBe('not-rechecked');
  });

  it('yakın zamanda görülen: seen-recently; eşik sınırı', () => {
    const v = view('1', [ob(745000, '2026-11-04', { searchKey: KEY })]); // tam 14 gün
    expect(lifecycleOf(v, {}, NOW, 14).status).toBe('not-rechecked');
    expect(lifecycleOf(v, {}, NOW, 15).status).toBe('seen-recently');
    expect(lifecycleOf(view('1', [ob(1, '2026-11-18T08:00:00.000Z')]), {}, NOW, 14)).toMatchObject({ status: 'seen-recently', daysSinceLastSeen: 0 });
  });

  it('approximate: uç gözlemlerden biri approx ise', () => {
    expect(lifecycleOf(view('1', [ob(1, '2026-11-17', { approx: true })]), {}, NOW, 14).approximate).toBe(true);
  });

  it('metin kesin "kaldırıldı/satıldı" demez', () => {
    const t = lifecycleNote(lc())!;
    expect(t).toContain('kaldırılmış olabilir');
    expect(t).toContain('2026-11-15');
    expect(t).not.toMatch(/satıldı|kaldırıldı/);
    const t2 = lifecycleNote(lc(old(), {}))!;
    expect(t2).toContain('bilinmiyor');
    expect(t2).not.toMatch(/satıldı|kaldırıldı|kaldırılmış/);
    expect(lifecycleNote({ ...lc(), status: 'seen-recently' })).toBeNull();
  });
});

describe('priceHistoryOf', () => {
  it('tüm para birimleriyle koşular, from/to', () => {
    const h = priceHistoryOf(view('1', [ob(745000, '2026-10-20'), ob(745000, '2026-11-02'), ob(15000, '2026-11-09', { currency: 'EUR' })]));
    expect(h).toEqual([
      { price: 745000, currency: 'TL', from: '2026-10-20T12:00:00.000Z', to: '2026-11-02T12:00:00.000Z' },
      { price: 15000, currency: 'EUR', from: '2026-11-09T12:00:00.000Z', to: '2026-11-09T12:00:00.000Z' },
    ]);
  });
});
