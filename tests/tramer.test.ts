import { describe, expect, it } from 'vitest';
import { extractTramerFromText as x } from '../src/sahibinden/tramer.js';

describe('tramer çıkarımı (açıklama, satıcı beyanı)', () => {
  it('tutar tramer kelimesinden önce gelebilir', () => {
    const r = x('Sol arka 2 parça halinde 170.000₺ yeni tarihli tramer mevcut, airbagler orijinal.');
    expect(r.amount).toBe(170000);
    expect(r.status).toBe('amount');
    expect(r.records).toHaveLength(1);
  });
  it('tarihli kayıtlar: tutarlı kayıt toplanır, tutarsız kayıt tarih/not ile listelenir', () => {
    const r = x('TRAMER; - 05/02/2021 Çarpma 18.250₺ - 14/09/2023 Çarpma');
    expect(r.amount).toBe(18250);
    expect(r.status).toBe('amount');
    expect(r.records).toEqual([
      { date: '2021-02-05', amount: 18250, note: 'Çarpma' },
      { date: '2023-09-14', note: 'Çarpma' },
    ]);
  });
  it('tutar sonra gelen basit ifade', () => {
    const r = x('Tramer 9.800₺ çıkmaktadır, güncel tarihli.');
    expect(r).toMatchObject({ amount: 9800, status: 'amount' });
  });
  it('"12 bin TL tramer" ve bin kısaltması', () => {
    expect(x('12 bin TL tramer kaydı var').amount).toBe(12000);
    expect(x('tramer 7,5 bin').amount).toBe(7500);
  });
  it('birden çok tutar toplanır', () => {
    const r = x('tramer: 5.500 TL ve 9.000 TL');
    expect(r.amount).toBe(14500);
    expect(r.records.map((c) => c.amount)).toEqual([5500, 9000]);
  });
  it('toplam + kalemler çift sayılmaz', () => {
    expect(x('Tramer toplam 14.500 TL (5.500 TL + 9.000 TL)').amount).toBe(14500);
  });
  it('tramer kelimesi olmadan tutar sayılmaz (fiyat, taksit)', () => {
    const r = x('Fiyat 850.000 TL, 12 TAKSİT SEÇENEĞİ mevcut, takas olur.');
    expect(r).toEqual({ amount: null, records: [], status: 'unknown' });
  });
  it('tramer geçse de taksit/fiyat tutarı tramer sayılmaz', () => {
    const r = x('Tramer kaydı var. Fiyat 640.000 TL, 12 TAKSİT SEÇENEĞİ.');
    expect(r.amount).toBeNull();
    expect(r.status).toBe('mentioned');
  });
  it('olumsuz ifadeler none', () => {
    for (const t of ['Araçta tramer kaydı yoktur.', 'Tramer yok', 'Aracımız tramersiz.', 'tramer kaydı bulunmamaktadır']) {
      expect(x(t)).toMatchObject({ amount: null, status: 'none' });
    }
  });
  it('olumsuz tramer yakınındaki alakasız tutar sayılmaz', () => {
    expect(x('Tramer yok, boya masrafı 3.000 TL').amount).toBeNull();
  });
  it('tutarsız tramer/çarpma mentioned', () => {
    expect(x('Tramer kaydı mevcut').status).toBe('mentioned');
    expect(x('Hafif çarpma geçmişi var').status).toBe('mentioned');
  });
  it('bahis yoksa unknown; boş metin null', () => {
    expect(x('Bakımlı temiz araç').status).toBe('unknown');
    expect(x(null)).toEqual({ amount: null, records: [], status: 'unknown' });
  });
});
