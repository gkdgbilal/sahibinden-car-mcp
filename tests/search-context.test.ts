import { describe, expect, it } from 'vitest';
import { searchContextOf } from '../src/sahibinden/search-context.js';

const B = 'https://www.sahibinden.com';

describe('searchContextOf', () => {
  const saved = `${B}/opel-astra-1.3-cdti?a5_min=2010&a5_max=2012&unpaintedParts=true&unchangingTracks=true&sorting=price_asc`;
  const canonical = `${B}/opel-astra-1.3-cdti`;
  const paging = `${B}/opel-astra-1.3-cdti?pagingOffset=20&unpaintedParts=true&unchangingTracks=true`;

  it('filtreli adaylar: filtreler, kategori, sıralama; anahtar pagingOffset/sorting içermez', () => {
    const c = searchContextOf([saved, canonical, paging])!;
    expect(c.filters).toEqual(['unpainted', 'noReplaced']);
    expect(c.category).toBe('opel-astra-1.3-cdti');
    expect(c.path).toBe('/opel-astra-1.3-cdti');
    expect(c.sorting).toBe('price_asc');
    expect(c.filtersKnown).toBe(true);
    expect(c.searchKey).not.toContain('pagingOffset');
    expect(c.searchKey).not.toContain('sorting');
    expect(c.searchKey).toBe('/opel-astra-1.3-cdti?a5_max=2012&a5_min=2010&unchangingTracks=true&unpaintedParts=true');
  });

  it('parametre sırası ve sayfalama/sıralama farkı anahtarı değiştirmez', () => {
    const a = searchContextOf([`${B}/opel-astra-1.3-cdti?unchangingTracks=true&a5_min=2010&unpaintedParts=true&a5_max=2012`])!;
    const b = searchContextOf([saved])!;
    const c = searchContextOf([`${B}/opel-astra-1.3-cdti/?a5_max=2012&pagingOffset=40&a5_min=2010&unpaintedParts=true&sorting=date_desc&unchangingTracks=true`])!;
    expect(a.searchKey).toBe(b.searchKey);
    expect(c.searchKey).toBe(b.searchKey);
  });

  it('farklı filtre -> farklı anahtar', () => {
    expect(searchContextOf([`${B}/x?unpaintedParts=true`])!.searchKey).not.toBe(searchContextOf([`${B}/x?unchangingTracks=true`])!.searchKey);
  });

  it('yalnız canonical: filtersKnown false, anahtar ?* ile biter, filtre yok', () => {
    const c = searchContextOf([canonical])!;
    expect(c.filtersKnown).toBe(false);
    expect(c.searchKey.endsWith('?*')).toBe(true);
    expect(c.filters).toEqual([]);
    expect(c.sorting).toBeNull();
  });

  it('yalnız gürültü parametreleri (sayfalama/sıralama) sorgu sayılmaz', () => {
    const c = searchContextOf([`${B}/opel-astra-1.3-cdti?pagingOffset=20&sorting=price_asc`])!;
    expect(c.filtersKnown).toBe(false);
    expect(c.searchKey).toBe('/opel-astra-1.3-cdti?*');
    expect(c.sorting).toBe('price_asc');
  });

  it('/otomobil için kategori null; şehir yolu kategoriyi bozmaz', () => {
    expect(searchContextOf([`${B}/otomobil`])!.category).toBeNull();
    expect(searchContextOf([`${B}/otomobil?unpaintedParts=true`])!.category).toBeNull();
    expect(searchContextOf([`${B}/opel-astra-1.3-cdti/samsun`])!.category).toBe('opel-astra-1.3-cdti');
  });

  it('a116445=1263354 (ağır hasarsız) -> noHeavyDamage; 1263353 (evet) filtre değil', () => {
    expect(searchContextOf([`${B}/otomobil?a116445=1263354`])!.filters).toEqual(['noHeavyDamage']);
    expect(searchContextOf([`${B}/otomobil?a116445=1263353`])!.filters).toEqual([]);
  });

  it('unpaintedParts=false filtre kanıtı değildir', () => {
    expect(searchContextOf([`${B}/otomobil?unpaintedParts=false`])!.filters).toEqual([]);
  });

  it('filtre herhangi bir adayda pozitif görülürse kanıt; geçersiz/boş aday listesi', () => {
    expect(searchContextOf([canonical, `${B}/opel-astra-1.3-cdti?unchangingTracks=true`])!.filters).toEqual(['noReplaced']);
    expect(searchContextOf([])).toBeNull();
    expect(searchContextOf(['mailto:x@y.z'])).toBeNull();
  });
});
