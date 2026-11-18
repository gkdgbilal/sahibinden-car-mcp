import { describe, expect, it } from 'vitest';
import { CITIES, PARAMS, resolveCity } from '../src/sahibinden/url-schema.js';

describe('url-schema', () => {
  it('81 il, plaka kodları 1..81 tekil', () => {
    expect(CITIES).toHaveLength(81);
    expect(CITIES.map((c) => c.code)).toEqual(Array.from({ length: 81 }, (_, i) => i + 1));
    expect(new Set(CITIES.map((c) => c.name)).size).toBe(81);
  });
  it('yalnızca Samsun (55) ve İstanbul (34) doğrulanmış', () => {
    expect(CITIES.filter((c) => c.verified).map((c) => c.code).sort((a, b) => a - b)).toEqual([34, 55]);
  });
  it('Türkçe katlama ile eşleşir', () => {
    expect(resolveCity('izmir')).toMatchObject({ code: 35, name: 'İzmir' });
    expect(resolveCity('İZMİR')?.code).toBe(35);
    expect(resolveCity('ISPARTA')?.code).toBe(32);
    expect(resolveCity('igdir')?.code).toBe(76);
    expect(resolveCity('Şanlıurfa')?.code).toBe(63);
    expect(resolveCity('sanliurfa')?.code).toBe(63);
    expect(resolveCity('Hakkari')?.code).toBe(30);
    expect(resolveCity('Afyon')?.code).toBe(3);
    expect(resolveCity('34')?.name).toBe('İstanbul');
    expect(resolveCity('Atlantis')).toBeUndefined();
    expect(resolveCity('')).toBeUndefined();
  });
  it('tüm parametre anahtarları doğrulanmış', () => {
    expect(Object.values(PARAMS).every((p) => p.verified)).toBe(true);
  });
});
