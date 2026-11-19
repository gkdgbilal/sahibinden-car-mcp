// scripts/catalog-data/*.txt + verified-extras.json -> src/sahibinden/catalog.json
// Girdiler sahibinden sidebar kategori ağacından (#searchCategoryContainer) okunmuş yollardır; bkz. docs/10-CATALOG.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, 'catalog-data', f), 'utf8').trim();
const title = (slug) => slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
const extras = JSON.parse(read('verified-extras.json'));

const categories = { otomobil: {}, 'arazi-suv-pickup': {}, 'minivan-panelvan': {} };

// Otomobil: marka|etiket|seri1,seri2 ; seri listesi taranan markalar tam sayılır (u yok).
for (const line of read('oto.txt').split('\n')) {
  const [slug, label, series] = line.split('|');
  const s = {};
  for (const x of (series ?? '').split(',').filter(Boolean)) s[x] = { l: title(x), e: null };
  categories.otomobil[slug] = { l: label, s };
}
// Seri listesi alınamayan otomobil markaları: u = "seri listesi bilinmiyor".
for (const line of read('unscraped.txt').split('\n')) {
  const [slug, label] = line.split('|');
  categories.otomobil[slug] = { l: label, s: {}, u: true };
}
// SUV ve minivan: yalnızca marka listesi (seri listeleri taranmadı).
for (const [cat, file] of [['arazi-suv-pickup', 'suv.txt'], ['minivan-panelvan', 'minivan.txt']]) {
  for (const item of read(file).split(';')) {
    const [slug, label] = item.split('|');
    categories[cat][slug] = { l: label, s: {}, u: true };
  }
}
for (const [slug, v] of Object.entries(extras.suvSeries)) {
  const b = categories['arazi-suv-pickup'][slug];
  if (!b) continue;
  for (const x of v.series) b.s[x] = { l: title(x), e: null };
  if (v.complete) delete b.u;
}
for (const [key, engines] of Object.entries(extras.engines)) {
  const [cat, brand, series] = key.split(':');
  const s = categories[cat]?.[brand]?.s?.[series];
  if (!s) throw new Error(`Bilinmeyen seri: ${key}`);
  s.e = engines;
}

const out = { generatedAt: '2026-11-19', categories };
fs.writeFileSync(path.join(here, '..', 'src', 'sahibinden', 'catalog.json'), JSON.stringify(out));
const n = (c) => Object.keys(categories[c]).length;
console.log(`otomobil ${n('otomobil')} marka, SUV ${n('arazi-suv-pickup')}, minivan ${n('minivan-panelvan')}`);
