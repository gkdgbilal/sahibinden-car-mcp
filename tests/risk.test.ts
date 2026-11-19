import { describe, expect, it } from 'vitest';
import { assessRisk, scanDescription } from '../src/analytics/risk.js';
import { NOW } from './helpers/views.js';
import { ORIGINAL, PAINTED, row } from './helpers/synthetic-market.js';

const codes = (d: string) => scanDescription(d).flags.map((f) => f.code);

describe('scanDescription', () => {
  it('riskli ifadeleri yakalar (Türkçe karakter ve büyük harf fark etmez)', () => {
    expect(codes('Motoru ARIZALI, şanzıman sorunlu.')).toEqual(expect.arrayContaining(['engine-fault']));
    expect(codes('Araç pert kayıtlıdır.')).toContain('pert');
    expect(codes('Şasi hasarı mevcut')).toContain('chassis');
    expect(codes('Kilometre düşürülmüş araç')).toContain('odometer');
    expect(codes('Satış vekaletname ile yapılır')).toContain('power-of-attorney');
    expect(codes('Acil satılık, borç nedeniyle')).toEqual(expect.arrayContaining(['urgent', 'lien']));
    expect(codes('Yağ yakıyor, turbo sorunu var')).toContain('fault-exists');
    expect(codes('Muayenesi yok')).toContain('inspection');
  });
  it('olumsuzlamalı cümleleri atlar', () => {
    expect(codes('Pert değil. Ağır hasar kaydı yoktur. Motor arızası yok.')).toEqual([]);
    expect(codes('Aracın herhangi bir sorunu bulunmamaktadır.')).toEqual([]);
  });
  it('olumsuzlama yalnızca kendi cümlesini etkiler', () => {
    expect(codes('Pert değil. Motoru arızalı.')).toEqual(['engine-fault']);
  });
  it('aynı kalıp bir kez bayraklanır; boş/null güvenli', () => {
    expect(codes('pert. pert! pert')).toEqual(['pert']);
    expect(scanDescription(null)).toEqual({ flags: [], positives: [] });
    expect(scanDescription('')).toEqual({ flags: [], positives: [] });
  });
  it('olumlu beyanları ayrı listeler', () => {
    const p = scanDescription('İlk sahibiyim. Bakımları yetkili serviste yapıldı. Ekspertiz yaptırılabilir.').positives;
    expect(p).toEqual(expect.arrayContaining(['Tek/ilk sahip beyanı', 'Düzenli/yetkili servis bakımı beyanı', 'Ekspertize açık/raporlu']));
  });
  it('ürün adı gibi zararsız metin bayrak üretmez', () => {
    expect(codes('Opel Astra 1.3 CDTI Enjoy, 2011 model, temiz kullanılmış.')).toEqual([]);
  });
});

describe('assessRisk', () => {
  const R = (o: Parameters<typeof row>[1]) => assessRisk(row('3000000001', { year: 2011, km: 180000, price: 700000, ...o }), NOW, 60);

  it('detay yoksa damage-unknown (low); temiz detayda bayrak yok', () => {
    const none = R({});
    expect(none.damageGroup).toBe('unknown');
    expect(none.flags.map((f) => f.code)).toContain('damage-unknown');
    expect(R({ damage: ORIGINAL, heavyDamage: false }).flags).toEqual([]);
  });
  it('ağır hasar high; yapısal değişen high; tek değişen medium; boyalı low', () => {
    expect(R({ damage: ORIGINAL, heavyDamage: true }).flags[0]).toMatchObject({ code: 'heavy-damage', severity: 'high' });
    expect(R({ damage: [{ part: 'Tavan', status: 'changed' }] }).flags[0]).toMatchObject({ code: 'replaced-parts', severity: 'high' });
    expect(R({ damage: [{ part: 'Ön Kaput', status: 'changed' }] }).flags[0]).toMatchObject({ code: 'replaced-parts', severity: 'medium' });
    expect(R({ damage: PAINTED }).flags[0]).toMatchObject({ code: 'painted-parts', severity: 'low' });
  });
  it('tramer kovaları', () => {
    expect(R({ damage: ORIGINAL, tramerAmount: 150000 }).flags.map((f) => f.code)).toContain('tramer-high');
    expect(R({ damage: ORIGINAL, tramerAmount: 50000 }).flags.map((f) => f.code)).toContain('tramer-mid');
    expect(R({ damage: ORIGINAL, tramerAmount: 10000 }).flags.map((f) => f.code)).toContain('tramer-low');
  });
  it('yıllık km: çok düşük medium, çok yüksek low, makul bayraksız', () => {
    expect(R({ damage: ORIGINAL, km: 30000 }).flags.map((f) => f.code)).toContain('km-low'); // 15 yıl, 2000 km/yıl
    expect(R({ damage: ORIGINAL, km: 900000 }).flags.map((f) => f.code)).toContain('km-high');
    expect(R({ damage: ORIGINAL, km: 180000 }).flags.map((f) => f.code)).not.toContain('km-low');
  });
  it('arama filtresi hatasız + detay hasarlı: evidence-conflict', () => {
    const c = R({ damage: PAINTED, filters: ['unpainted', 'noReplaced'], searchKey: 'k' });
    expect(c.flags.map((f) => f.code)).toContain('evidence-conflict');
    expect(c.damageEvidence).toBe('detail');
  });
});
