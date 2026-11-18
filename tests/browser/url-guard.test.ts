import { describe, expect, it } from 'vitest';
import { assertAllowedUrl, listingUrlFor } from '../../src/browser/url-guard.js';

describe('assertAllowedUrl', () => {
  it('kabul: https www.sahibinden.com', () => {
    expect(assertAllowedUrl('https://www.sahibinden.com/opel-astra?x=1').hostname).toBe('www.sahibinden.com');
    expect(assertAllowedUrl('https://www.sahibinden.com:443/otomobil').pathname).toBe('/otomobil');
  });
  it.each([
    'http://www.sahibinden.com/',
    'https://sahibinden.com/',
    'https://secure.sahibinden.com/giris',
    'https://www.sahibinden.com.evil.test/',
    'https://evil.test/?u=https://www.sahibinden.com',
    'https://user@www.sahibinden.com/',
    'https://user:pw@www.sahibinden.com/',
    'https://www.sahibinden.com:8443/',
    'https://evil.test\\@www.sahibinden.com/',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'about:blank',
    '//www.sahibinden.com/',
    'not a url',
    '',
  ])('ret: %s', (u) => {
    expect(() => assertAllowedUrl(u)).toThrow();
  });
  it('izinli host listesi enjekte edilebilir (yalnızca https)', () => {
    expect(() => assertAllowedUrl('https://example.test/x', ['example.test'])).not.toThrow();
    expect(() => assertAllowedUrl('http://example.test/x', ['example.test'])).toThrow();
  });
  it('hata kodu unexpected-page', () => {
    try {
      assertAllowedUrl('https://evil.test/');
      expect.unreachable();
    } catch (e) {
      expect((e as { code: string }).code).toBe('unexpected-page');
    }
  });
});

describe('listingUrlFor', () => {
  const none = () => null;
  it('ilan no → yedek URL', () => {
    expect(listingUrlFor('1000000001', none)).toEqual({ id: '1000000001', url: 'https://www.sahibinden.com/ilan/1000000001/detay' });
  });
  it('mağazadaki bilinen izinli URL tercih edilir (sorgu parametresi atılır)', () => {
    const known = () => 'https://www.sahibinden.com/ilan/vasita-otomobil-golf-1000000001/detay?query=abc';
    expect(listingUrlFor('1000000001', known)?.url).toBe('https://www.sahibinden.com/ilan/vasita-otomobil-golf-1000000001/detay');
  });
  it('mağazadaki izinsiz URL yok sayılır', () => {
    expect(listingUrlFor('1000000001', () => 'https://evil.test/ilan/x-1000000001/detay')?.url).toBe(
      'https://www.sahibinden.com/ilan/1000000001/detay',
    );
  });
  it('ilan URL referansı kabul, başka host/yol reddedilir', () => {
    expect(listingUrlFor('https://www.sahibinden.com/ilan/vasita-otomobil-x-1000000002/detay?a=1#b', none)).toEqual({
      id: '1000000002',
      url: 'https://www.sahibinden.com/ilan/vasita-otomobil-x-1000000002/detay',
    });
    expect(listingUrlFor('https://evil.test/ilan/x-1000000002/detay', none)).toBeNull();
    expect(listingUrlFor('https://www.sahibinden.com/otomobil/x-1000000002', none)).toBeNull();
    expect(listingUrlFor('javascript:1000000002', none)).toBeNull();
  });
  it('geçersiz ref', () => {
    expect(listingUrlFor('abc', none)).toBeNull();
    expect(listingUrlFor('123', none)).toBeNull();
  });
});
