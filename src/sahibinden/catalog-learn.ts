import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import type { Catalog, TreeItem } from './catalog.js';

/**
 * Kaydedilmiş/okunmuş bir arama sayfasının sidebar kategori ağacı (`#searchCategoryContainer`). Sitenin kendi
 * yollarıdır: marka (cl2), seri/model (cl3), motor (cl4). Sayfada ağaç yoksa boş döner. Saf: ağ/dosya yok.
 */
export function extractCategoryTree(html: string): TreeItem[] {
  const $ = cheerio.load(html);
  const out: TreeItem[] = [];
  $('#searchCategoryContainer li').each((_, li) => {
    const cls = ($(li).attr('class') ?? '').split(/\s+/).find((c) => /^cl[234]$/.test(c)) as TreeItem['cl'] | undefined;
    const a = $(li).find('a').first();
    const href = a.attr('href');
    if (!cls || !href) return;
    let p: string;
    try {
      p = new URL(href, 'https://www.sahibinden.com').pathname.replace(/^\/+|\/+$/g, '');
    } catch {
      return;
    }
    if (!p || p.includes('/')) return; // "otomobil/elektrik" gibi filtre yolları kategori değildir
    out.push({ cl: cls, path: p, text: a.text().replace(/\s+/g, ' ').replace(/\s*\(\s*[\d.,]+\s*\)\s*$/, '').trim() });
  });
  return out;
}

/**
 * İçe aktarılan arama sayfalarından öğrenilen kategori yollarını diske yazar (homeDir/catalog-learned.json) ve
 * açılışta kataloğa uygular. Böylece yalnızca kullanıcının zaten açtığı sayfalar (ek istek yok) kataloğu
 * motor düzeyinde zenginleştirir.
 */
export class CatalogLearner {
  private items = new Map<string, TreeItem>();

  constructor(private readonly catalog: Catalog, private readonly file: string) {}

  /** Dosyadaki öğrenilmiş yolları kataloğa uygular; bozuk/eksik dosya sessizce yok sayılır. */
  load(): number {
    let list: TreeItem[] = [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { items?: TreeItem[] };
      list = Array.isArray(raw.items) ? raw.items.filter((i) => i && typeof i.path === 'string' && /^cl[234]$/.test(i.cl)) : [];
    } catch {
      return 0;
    }
    for (const i of list) this.items.set(`${i.cl}:${i.path}`, i);
    return this.catalog.learn(list);
  }

  /** Sayfa ağacını uygular; yeni kayıt varsa diske yazar. Eklenen sayısını döner. */
  addFromHtml(html: string): number {
    const tree = extractCategoryTree(html);
    if (tree.length === 0) return 0;
    const added = this.catalog.learn(tree);
    let fresh = false;
    for (const i of tree) {
      const key = `${i.cl}:${i.path}`;
      if (!this.items.has(key)) { this.items.set(key, i); fresh = true; }
    }
    if (fresh) this.save();
    return added;
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, items: [...this.items.values()] }));
      fs.renameSync(tmp, this.file);
    } catch {
      // önbellek yazılamazsa sessizce atla; katalog bellekte güncel kalır
    }
  }
}
