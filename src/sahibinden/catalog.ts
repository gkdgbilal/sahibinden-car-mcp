import bundled from './catalog.json' with { type: 'json' };
import { foldTr } from './normalize.js';
import { CATEGORY_LABELS, CATEGORY_PROFILES, type CategoryId } from './url-schema.js';

/**
 * Sahibinden araç kataloğu: kategori -> marka -> seri/model -> motor. Tamamı sitenin kendi sidebar kategori ağacından
 * okundu (`#searchCategoryContainer`, scripts/catalog notları: docs/10-CATALOG.md); hiçbir yol tahmin edilmez.
 * Yol = kategori öneki + marka + "-" + seri [+ "-" + motor]. Örn. otomobil: bmw-3-serisi-320d,
 * SUV: arazi-suv-pickup-bmw-x5-30d-xdrive, minivan: minivan-panelvan-fiat-doblo-1.3-multijet.
 */
export interface CatalogSeries {
  /** Sitedeki görünen ad ("3 Serisi", "Astra"). */
  l: string;
  /** Motor/versiyon yol parçaları (seri yolundan sonraki kısım); null = seri sayfası taranamadı. */
  e: string[] | null;
}
export interface CatalogBrand {
  l: string;
  s: Record<string, CatalogSeries>;
  /** true: bu kategoride markanın seri listesi bilinmiyor (taranmadı); eşleşmeyen modeller için yol kurala göre tahmin edilir. */
  u?: boolean;
}
export interface CatalogData {
  generatedAt: string | null;
  categories: Partial<Record<CategoryId, Record<string, CatalogBrand>>>;
}

/** Sidebar kategori ağacından bir satır: cl2 marka, cl3 seri/model, cl4 motor; path başında "/" olmadan. */
export interface TreeItem {
  cl: 'cl2' | 'cl3' | 'cl4';
  path: string;
  text: string;
}

export type TargetLevel = 'brand' | 'series' | 'engine';

export interface VehicleTarget {
  category: CategoryId;
  /** Başında "/" olmayan arama yolu. */
  path: string;
  level: TargetLevel;
  /** "BMW 3 Serisi 320d" gibi insan okur ad. */
  label: string;
  /** İstenen ifadenin tamamı yola karşılık geldi mi (false: ek bir parça, ör. donanım paketi, yola yansımadı). */
  exact: boolean;
  notes: string[];
}

export interface Resolution {
  targets: VehicleTarget[];
  /** Katalogda hiçbir karşılık bulunamadı (marka bile). Çağıran eski/yedek davranışa düşebilir. */
  unresolved: boolean;
  notes: string[];
}

/** Karşılaştırma anahtarı: Türkçe katlama, yalnızca harf+rakam ("C 200 d" = "c200d", "1.3 CDTI" = "13cdti"). */
export const squashKey = (s: string | null | undefined): string => foldTr(s).replace(/[^a-z0-9]+/g, '');

const BRAND_ALIASES: Record<string, string> = {
  mercedes: 'mercedesbenz', benz: 'mercedesbenz', mb: 'mercedesbenz',
  vw: 'volkswagen', chevy: 'chevrolet', merc: 'mercedesbenz',
};

const CATEGORY_ORDER: CategoryId[] = ['otomobil', 'arazi-suv-pickup', 'minivan-panelvan'];

interface SeriesHit {
  category: CategoryId;
  bslug: string;
  brand: CatalogBrand;
  sslug: string;
  series: CatalogSeries;
}

const pathOf = (cat: CategoryId, bslug: string, sslug?: string, engine?: string) =>
  CATEGORY_PROFILES[cat].pathPrefix + [bslug, sslug, engine].filter((x) => x !== undefined).join('-');

/** "3 Serisi" -> ["3serisi", "3"]; "Astra" -> ["astra"]; slug ve etiket anahtarları birleşir. */
function seriesKeys(sslug: string, label: string): string[] {
  const keys = new Set<string>();
  for (const raw of [sslug, label]) {
    const k = squashKey(raw);
    if (k) keys.add(k);
    if (k.endsWith('serisi') && k.length > 6) keys.add(k.slice(0, -6));
  }
  return [...keys].sort((a, b) => b.length - a.length);
}

export class Catalog {
  constructor(readonly data: CatalogData) {}

  get isEmpty(): boolean {
    return CATEGORY_ORDER.every((c) => Object.keys(this.data.categories[c] ?? {}).length === 0);
  }

  /**
   * Bir arama sayfasının sidebar kategori ağacından (cl2 marka, cl3 seri, cl4 motor) yeni marka/seri/motor yollarını
   * ekler. Yalnızca sitenin kendi yolları gelir; mevcut kayıtlar silinmez. Eklenen kayıt sayısını döner.
   */
  learn(items: readonly TreeItem[]): number {
    let added = 0;
    for (const it of items) {
      const p = it.path.replace(/^\/+/, '');
      const category = CATEGORY_ORDER.find((c) => c !== 'otomobil' && p.startsWith(CATEGORY_PROFILES[c].pathPrefix)) ?? 'otomobil';
      const rest = p.slice(CATEGORY_PROFILES[category].pathPrefix.length);
      const brands = (this.data.categories[category] ??= {});
      if (it.cl === 'cl2') {
        if (rest && !brands[rest]) { brands[rest] = { l: it.text || rest, s: {} }; added++; }
        continue;
      }
      const bslug = Object.keys(brands).filter((b) => rest.startsWith(`${b}-`)).sort((a, b) => b.length - a.length)[0];
      if (!bslug) continue;
      const brand = brands[bslug]!;
      const tail = rest.slice(bslug.length + 1);
      if (it.cl === 'cl3') {
        if (tail && !brand.s[tail]) { brand.s[tail] = { l: it.text || tail, e: null }; added++; }
      } else if (it.cl === 'cl4') {
        const sslug = Object.keys(brand.s).filter((s) => tail.startsWith(`${s}-`)).sort((a, b) => b.length - a.length)[0];
        if (!sslug) continue;
        const series = brand.s[sslug]!;
        const engine = tail.slice(sslug.length + 1);
        series.e ??= [];
        if (engine && !series.e.includes(engine)) { series.e.push(engine); added++; }
      }
    }
    return added;
  }

  /** Marka girdisine (ad ya da slug) uyan (kategori, marka) kayıtları; kategori sırası otomobil, SUV, minivan. */
  findBrands(input: string): { category: CategoryId; bslug: string; brand: CatalogBrand }[] {
    const raw = squashKey(input);
    const key = BRAND_ALIASES[raw] ?? raw;
    if (!key) return [];
    const out: { category: CategoryId; bslug: string; brand: CatalogBrand }[] = [];
    for (const category of CATEGORY_ORDER) {
      for (const [bslug, brand] of Object.entries(this.data.categories[category] ?? {})) {
        if (squashKey(bslug) === key || squashKey(brand.l) === key) out.push({ category, bslug, brand });
      }
    }
    return out;
  }

  private *allSeries(brands: { category: CategoryId; bslug: string; brand: CatalogBrand }[]): Generator<SeriesHit> {
    for (const { category, bslug, brand } of brands) {
      for (const [sslug, series] of Object.entries(brand.s)) yield { category, bslug, brand, sslug, series };
    }
  }

  private allBrands() {
    const out: { category: CategoryId; bslug: string; brand: CatalogBrand }[] = [];
    for (const category of CATEGORY_ORDER) {
      for (const [bslug, brand] of Object.entries(this.data.categories[category] ?? {})) out.push({ category, bslug, brand });
    }
    return out;
  }

  /**
   * Model ifadesini verilen markalar içinde çözer. `strict`: marka bilinmiyor (çıkarım); yalnızca tam seri/motor
   * eşleşmeleri kabul edilir, "önek" tahmini yapılmaz.
   */
  private matchModel(brands: { category: CategoryId; bslug: string; brand: CatalogBrand }[], model: string, strict: boolean): VehicleTarget[] {
    let ms = squashKey(model);
    // Marka adı modele yazılmışsa ("Opel Astra") at.
    for (const b of brands) {
      for (const bk of [squashKey(b.bslug), squashKey(b.brand.l)]) {
        if (bk && ms.length > bk.length && ms.startsWith(bk) && !strict) { ms = ms.slice(bk.length); break; }
      }
    }
    if (!ms) return [];

    const make = (h: SeriesHit, level: TargetLevel, exact: boolean, engine?: string, notes: string[] = []): VehicleTarget => ({
      category: h.category,
      path: level === 'engine' ? pathOf(h.category, h.bslug, h.sslug, engine) : pathOf(h.category, h.bslug, h.sslug),
      level,
      label: `${h.brand.l} ${h.series.l}${engine ? ` ${engine.replace(/-/g, ' ')}` : ''}`,
      exact,
      notes,
    });
    const dedupe = (ts: VehicleTarget[]) => [...new Map(ts.map((t) => [t.path, t])).values()];

    const exactEngine: VehicleTarget[] = [];
    const exactSeries: VehicleTarget[] = [];
    const partial: { h: SeriesHit; key: string; rest: string }[] = [];
    const enginePrefix: { h: SeriesHit; engine: string; len: number }[] = [];

    for (const h of this.allSeries(brands)) {
      const keys = seriesKeys(h.sslug, h.series.l);
      if (keys.includes(ms)) exactSeries.push(make(h, 'series', true));
      for (const e of h.series.e ?? []) {
        const ek = squashKey(e);
        if (!ek) continue;
        if (ms === ek || keys.some((k) => ms === k + ek)) exactEngine.push(make(h, 'engine', true, e));
        else if (!strict && ek.length >= 3 && (ms.startsWith(ek) || keys.some((k) => ms.startsWith(k + ek)))) {
          const len = ms.startsWith(ek) ? ek.length : Math.max(...keys.filter((k) => ms.startsWith(k + ek)).map((k) => k.length + ek.length));
          enginePrefix.push({ h, engine: e, len });
        }
      }
      if (!strict) {
        for (const k of keys) {
          if (!(ms.length > k.length && ms.startsWith(k))) continue;
          const rest = ms.slice(k.length);
          // Kısa anahtar ("z", "c", "3") tek başına yetmez: kalan parça bu serinin bir motorunun başlangıcına benzemeli.
          if (k.length < 3) {
            const plausible = (h.series.e ?? []).some((e) => {
              const ek = squashKey(e);
              return ek.startsWith(rest) || ek.startsWith(ms) || (k + ek).startsWith(ms);
            });
            if (!plausible) continue;
          }
          partial.push({ h, key: k, rest });
        }
      }
    }

    if (exactEngine.length) return dedupe(exactEngine);
    if (exactSeries.length) return dedupe(exactSeries);
    if (strict) return [];

    // "Motor + ek parça" ("320d M Sport"): en uzun motor önekini al, kalan parça yola yansımaz.
    if (enginePrefix.length) {
      const best = Math.max(...enginePrefix.map((x) => x.len));
      return dedupe(enginePrefix.filter((x) => x.len === best).map((x) => make(x.h, 'engine', false, x.engine, [
        `"${model}" ifadesinin sondaki parçası (paket/donanım) sitede ayrı yol olarak doğrulanmadı; motor sayfası kullanıldı, paketi yerel filtre ya da panel seçsin.`,
      ])));
    }
    // "Seri + motor" ama motor yok ("Astra 1.9"): seri sayfası.
    const keyed = partial;
    if (keyed.length) {
      const longest = Math.max(...keyed.map((p) => p.key.length));
      const hits = keyed.filter((p) => p.key.length === longest);
      return dedupe(hits.map((p) => {
        const similar = (p.h.series.e ?? []).filter((e) => squashKey(e).startsWith(p.rest.slice(0, 2))).slice(0, 8);
        const note = `"${p.rest}" motor/versiyonu ${p.h.brand.l} ${p.h.series.l} için katalogda yok; seri sayfası kullanıldı.` +
          (similar.length ? ` Benzer yollar: ${similar.join(', ')}.` : '');
        return make(p.h, 'series', false, undefined, [note]);
      }));
    }
    return [];
  }

  /**
   * Seri listesi bilinmeyen (u) kategorilerde, katalogda eşleşmeyen model için yol tahmini: marka yolu + "-" + modelin
   * slug'ı (taranan 566 serinin hepsinde yol = slug(etiket)). Doğrulanmadığı için exact=false ve uyarı notuyla döner.
   */
  private guessUnknown(brands: { category: CategoryId; bslug: string; brand: CatalogBrand }[], model: string): VehicleTarget[] {
    const slug = foldTr(model).replace(/[^a-z0-9.]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
    if (!slug) return [];
    const unknown = brands.filter((b) => b.brand.u);
    if (unknown.length === 0) return [];
    // Tek kategori: ipucu verdiyse o, yoksa sırayla ilk (otomobil önce). Üç kategoride birden tahmin gürültü olur.
    const hinted = hintCategory(unknown[0]!.bslug, squashKey(model));
    const pick = unknown.find((b) => b.category === hinted) ?? unknown[0]!;
    return [{
      category: pick.category,
      path: pathOf(pick.category, pick.bslug, slug),
      level: 'series' as const,
      label: `${pick.brand.l} ${model}`,
      exact: false,
      notes: [
        `${pick.brand.l} için ${CATEGORY_LABELS[pick.category]} kategorisinin seri listesi katalogda yok; /${pathOf(pick.category, pick.bslug, slug)} yolu ` +
          'sitenin adlandırma kuralından türetildi ve doğrulanmadı. Sayfa "bulunamadı" derse ya da başka kategoriyi gösterirse markanın sayfasından seriyi seçin.',
      ],
    }];
  }

  /**
   * (marka, model) -> arama hedefleri. Marka yoksa model adından marka çıkarılır (yalnızca tam seri/motor eşleşmesi).
   * Yalnızca marka: markanın bulunduğu her kategori için bir hedef (otomobil önce).
   */
  resolve(brand: string | undefined, model: string | null): Resolution {
    if (this.isEmpty) return { targets: [], unresolved: true, notes: [] };
    const notes: string[] = [];
    const brandHits = brand ? this.findBrands(brand) : [];

    const brandTargets = (hits: typeof brandHits): VehicleTarget[] =>
      hits.map(({ category, bslug, brand: b }) => ({
        category, path: pathOf(category, bslug), level: 'brand', label: b.l, exact: true, notes: [],
      }));

    if (brandHits.length) {
      if (!model) return { targets: brandTargets(brandHits), unresolved: false, notes };
      const mk = squashKey(model);
      let targets: VehicleTarget[] = [];
      if (mk.startsWith('rangerover') && mk.length > 'rangerover'.length) {
        // "Range Rover Sport" tam seri; "Range Rover Discovery" gibi karışık yazımda Range Rover önekini at.
        targets = this.matchModel(brandHits, model, true);
        if (!targets.length) targets = this.matchModel(brandHits, mk.slice('rangerover'.length), true);
      }
      if (!targets.length) targets = this.matchModel(brandHits, model, false);
      if (targets.length) return { targets, unresolved: false, notes };
      const guesses = this.guessUnknown(brandHits, model);
      if (guesses.length) return { targets: guesses, unresolved: false, notes };
      const some = brandHits.flatMap((h) => Object.values(h.brand.s).map((s) => s.l)).slice(0, 25);
      notes.push(`"${model}" ${brandHits[0]!.brand.l} markasının katalogunda bulunamadı; marka sayfası kullanıldı. Mevcut seriler: ${[...new Set(some)].join(', ')}.`);
      return { targets: brandTargets(brandHits), unresolved: false, notes };
    }

    // Marka bilinmiyor/tanınmadı: modelden (ve varsa tanınmayan marka girdisinden) çıkar.
    const candidates = [model, brand && model ? `${brand} ${model}` : null, brand && !model ? brand : null].filter((x): x is string => !!x);
    for (const c of candidates) {
      const targets = this.matchModel(this.allBrands(), c, true);
      if (targets.length === 0) continue;
      const brands = new Set(targets.map((t) => t.label.split(' ')[0]));
      if (brands.size > 3) continue; // fazla belirsiz
      if (targets.length > 1) notes.push(`"${c}" birden fazla yolla eşleşti: ${targets.map((t) => `/${t.path}`).join(', ')}.`);
      return { targets, unresolved: false, notes };
    }
    // Seri listesi taranamayan markaların bilinen modelleri: yalnızca markayı çıkarır, yol yine kurala göre tahmin edilir.
    if (model) {
      const mk = squashKey(model);
      const hint = Object.entries(MODEL_BRAND_HINTS).find(([, models]) => models.some((m) => mk === hintKey(m) || (hintKey(m).length >= 4 && mk.startsWith(hintKey(m)))));
      if (hint) {
        const res = this.resolve(hint[0], model);
        if (res.targets.length) return { ...res, notes: [...notes, ...res.notes, `Marka modelden (${hint[0]}) çıkarıldı.`] };
      }
    }
    return { targets: [], unresolved: true, notes };
  }
}

/**
 * Seri listesi (henüz) taranamayan markalar için yaygın model -> marka ipuçları. Yalnızca marka (ve varsa kategori)
 * çıkarır; yol yine kurala göre tahmin edilir. Anahtar: marka slug'ı; değer: squashKey biçiminde model, ":suv" /
 * ":minivan" son eki kategori ipucudur (yoksa otomobil).
 */
const MODEL_BRAND_HINTS: Record<string, string[]> = {
  volkswagen: ['golf', 'passat', 'polo', 'jetta', 'tiguan:suv', 'touran', 'caddy:minivan', 'transporter:minivan', 'caravelle:minivan', 'arteon', 'troc:suv', 'scirocco', 'beetle', 'touareg:suv', 'bora', 'lupo', 'sharan', 'id4:suv'],
  toyota: ['corolla', 'yaris', 'auris', 'avensis', 'camry', 'chr:suv', 'rav4:suv', 'hilux:suv', 'landcruiser:suv', 'proace:minivan', 'aygo', 'verso', 'supra', 'prius'],
  skoda: ['octavia', 'fabia', 'superb', 'rapid', 'kodiaq:suv', 'karoq:suv', 'kamiq:suv', 'scala', 'yeti:suv', 'roomster', 'citigo', 'enyaq:suv'],
  seat: ['leon', 'ibiza', 'ateca:suv', 'arona:suv', 'toledo', 'cordoba', 'altea', 'alhambra', 'tarraco:suv', 'mii'],
  volvo: ['s40', 's60', 's80', 's90', 'v40', 'v50', 'v60', 'v70', 'v90', 'xc40:suv', 'xc60:suv', 'xc70:suv', 'xc90:suv', 'c30', 'c70'],
  tofas: ['sahin', 'dogan', 'kartal', 'serce', 'murat'],
  tesla: ['modely:suv', 'models', 'model3', 'modelx:suv'],
  suzuki: ['swift', 'vitara:suv', 'sx4', 'jimny:suv', 'baleno', 'ignis', 'celerio', 'alto', 'splash'],
  subaru: ['impreza', 'legacy', 'outback:suv', 'forester:suv', 'xv:suv', 'brz', 'wrx'],
  smart: ['fortwo', 'forfour'],
};

const HINT_CATEGORY: Record<string, CategoryId> = { suv: 'arazi-suv-pickup', minivan: 'minivan-panelvan' };
const hintKey = (h: string) => h.split(':')[0]!;

/** Marka için model ipucundan kategori (":suv"/":minivan"); ipucu yoksa undefined. */
function hintCategory(bslug: string, mk: string): CategoryId | undefined {
  const h = (MODEL_BRAND_HINTS[bslug] ?? []).find((x) => mk === hintKey(x) || (hintKey(x).length >= 4 && mk.startsWith(hintKey(x))));
  const tag = h?.split(':')[1];
  return tag ? HINT_CATEGORY[tag] : undefined;
}

export const catalog = new Catalog(bundled as unknown as CatalogData);
export const resolveVehicle = (brand: string | undefined, model: string | null) => catalog.resolve(brand, model);
