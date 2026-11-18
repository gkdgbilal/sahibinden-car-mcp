import { load } from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import { DESCRIPTION_MAX } from '../config.js';
import {
  foldTr,
  mapFuel,
  mapSellerType,
  mapTransmission,
  parseCurrency,
  parseRangeOrNumber,
  parseTrDate,
  parseTrNumber,
  parseYesNo,
} from './normalize.js';
import { CITIES, citySlug, resolveCity } from './url-schema.js';
import type { CityEntry } from './url-schema.js';
import type {
  Listing,
  ListingSummary,
  PageType,
  ParseContext,
  PartStatus,
} from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sel = Cheerio<any>;

const SITE = 'https://www.sahibinden.com';

/** Satıcı/iletişim bilgisi taşıyabilecek etiketler: asla attributes'a yazılmaz. */
const PRIVATE_LABELS = new Set(['satici', 'telefon', 'tel', 'gsm', 'cep', 'magaza', 'uye', 'iletisim']);

const PHONE_RE = /(?:\+?90[\s-]?)?0?\s?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g;

// ---------- yardımcılar ----------

const clean = (s: string | undefined | null): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** Hücreyi <br> sınırlarında satırlara böler. */
function cellLines($: CheerioAPI, el: Sel): string[] {
  const copy = el.clone();
  copy.find('br').replaceWith('\n');
  return copy
    .text()
    .split('\n')
    .map(clean)
    .filter(Boolean);
}

const cellText = ($: CheerioAPI, el: Sel): string => cellLines($, el).join(' ');

function absUrl(href: string | undefined): string | null {
  if (!href) return null;
  const noQuery = href.split(/[?#]/)[0]!.trim();
  if (!noQuery) return null;
  if (/^https?:\/\//i.test(noQuery)) return noQuery;
  return `${SITE}${noQuery.startsWith('/') ? '' : '/'}${noQuery}`;
}

function idFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/-(\d{8,12})(?:\/detay)?\/?$/) ?? url.match(/-(\d{8,12})\/detay/);
  return m ? m[1]! : null;
}

// ---------- sayfa tipi ----------

export function detectPageType(html: string): PageType {
  const $ = load(html);
  const title = foldTr($('title').first().text());
  if (
    title.includes('just a moment') ||
    html.includes('_cf_chl_opt') ||
    html.includes('challenges.cloudflare.com')
  ) {
    return 'challenge';
  }
  if ($('tr.searchResultsItem').length > 0 || $('#searchResultsTable').length > 0) return 'search';
  if ($('.classifiedInfoList').length > 0) return 'listing';
  const hasIlanNo = $('li strong, dt')
    .toArray()
    .some((e) => foldTr($(e).text()) === 'ilan no');
  return hasIlanNo ? 'listing' : 'unknown';
}

/** canonical -> og:url -> "saved from url" yorumu -> ctx.sourceUrl. */
export function extractPageUrl($: CheerioAPI, html: string, ctx: ParseContext): string | null {
  const canonical = $('link[rel="canonical"]').attr('href');
  if (canonical) return absUrl(canonical);
  const og = $('meta[property="og:url"]').attr('content');
  if (og) return absUrl(og);
  const saved = html.match(/<!--\s*saved from url=\(\d+\)(\S+?)\s*-->/i);
  if (saved) return saved[1]!;
  return ctx.sourceUrl ?? null;
}

// ---------- arama sayfası ----------

type SearchField =
  | 'series' | 'model' | 'title' | 'year' | 'km' | 'color' | 'price' | 'date' | 'location';

const HEADER_MAP: Record<string, SearchField> = {
  seri: 'series',
  model: 'model',
  'ilan basligi': 'title',
  yil: 'year',
  km: 'km',
  renk: 'color',
  fiyat: 'price',
  'ilan tarihi': 'date',
  'il/ilce': 'location',
};

const CLASS_FALLBACK: Partial<Record<SearchField, string>> = {
  series: '.searchResultsTagAttributeValue',
  title: '.searchResultsTitleValue',
  price: '.searchResultsPriceValue',
  date: '.searchResultsDateValue',
  location: '.searchResultsLocationValue',
};

export interface SearchPagination {
  /** Sayfalama bağlantılarındaki `pagingOffset` değerleri (artan, tekil). */
  offsets: number[];
  /** En küçük sıfırdan büyük offset = sayfa boyutu (ör. 20); yoksa null. */
  pageSize: number | null;
}

/** Konum hücresinin nasıl okunduğu: şehir filtreli sayfada hücre "İlçe Mahalle", filtresizde "İl İlçe". */
export interface LocationContext {
  mode: 'city-filtered' | 'unfiltered' | 'ambiguous';
  /** city-filtered iken il adı. */
  city: string | null;
  source: 'hint' | 'url' | 'title' | null;
}

export interface SearchParseResult {
  items: ListingSummary[];
  warnings: string[];
  /** "aramanızda 2.836 ilan bulundu" -> 2836; bulunamazsa null. */
  totalCount: number | null;
  pagination: SearchPagination | null;
  location: LocationContext;
}

/** URL'den şehir: `address_city=<plaka>` sorgusu ya da son yol parçası şehir slug'ı (/opel-astra/samsun). */
function cityFromUrl(url: string | null | undefined): CityEntry | undefined {
  if (!url) return undefined;
  let u: URL;
  try {
    u = new URL(url, SITE);
  } catch {
    return undefined;
  }
  const code = u.searchParams.get('address_city');
  if (code) return resolveCity(code);
  const last = u.pathname.split('/').filter(Boolean).pop();
  if (!last) return undefined;
  return CITIES.find((c) => citySlug(c) === last.toLowerCase());
}

/** Başlık şehir adıyla başlıyorsa ("Samsun Opel Astra ... Fiyatları") o şehir. */
function cityFromTitle(title: string): CityEntry | undefined {
  const t = foldTr(title);
  return CITIES.find((c) => {
    const n = foldTr(c.name);
    return t === n || t.startsWith(`${n} `);
  });
}

/** Şehir filtresi bağlamını belirler; çelişen sinyaller "ambiguous" döner (tahmin yürütülmez). */
function detectLocationContext($: CheerioAPI, html: string, ctx: ParseContext): LocationContext {
  if (ctx.cityHint) {
    const c = resolveCity(ctx.cityHint);
    return c
      ? { mode: 'city-filtered', city: c.name, source: 'hint' }
      : { mode: 'ambiguous', city: null, source: 'hint' };
  }
  const urlCities = [extractPageUrl($, html, ctx), ctx.sourceUrl]
    .map(cityFromUrl)
    .filter((c): c is CityEntry => c !== undefined);
  const fromUrl = new Set(urlCities.map((c) => c.code));
  if (fromUrl.size > 1) return { mode: 'ambiguous', city: null, source: 'url' };
  const titleCity = cityFromTitle($('title').first().text());
  if (fromUrl.size === 1) {
    const c = urlCities[0]!;
    if (titleCity && titleCity.code !== c.code) return { mode: 'ambiguous', city: null, source: 'url' };
    return { mode: 'city-filtered', city: c.name, source: 'url' };
  }
  if (titleCity) return { mode: 'city-filtered', city: titleCity.name, source: 'title' };
  return { mode: 'unfiltered', city: null, source: null };
}

interface ParsedLocation {
  city: string | null;
  district: string | null;
  neighborhood?: string | null;
  locationRaw?: string;
  warning?: string;
}

/**
 * Konum hücresi: filtresiz sayfada "İl İlçe", şehir filtreli sayfada "İlçe Mahalle".
 * Belirsizse il/ilçe boş bırakılır, ham metin locationRaw'da korunur.
 */
function parseLocation(lines: string[], loc: LocationContext, id: string): ParsedLocation {
  if (lines.length === 0) return { city: null, district: null };
  const raw = lines.join(' ');
  const ambiguous = (why: string): ParsedLocation => ({
    city: null, district: null, locationRaw: raw, warning: `${id}: konum belirsiz (${why}); ham metin locationRaw'da`,
  });
  // <br> ile ayrık satırlar yoksa boşluktan böl.
  const split = (): string[] => {
    if (lines.length >= 2) return [lines[0]!, lines.slice(1).join(' ')];
    const parts = raw.split(' ');
    // "19 Mayıs" gibi sayıyla başlayan ilçe adı iki kelimedir.
    const n = /^\d+$/.test(parts[0]!) && parts.length > 2 ? 2 : 1;
    return parts.length > n ? [parts.slice(0, n).join(' '), parts.slice(n).join(' ')] : [raw];
  };
  const [first = '', rest] = split();

  if (loc.mode === 'ambiguous') return ambiguous('şehir filtresi sinyalleri çelişiyor');
  if (loc.mode === 'city-filtered') {
    if (foldTr(first) === foldTr(loc.city)) return ambiguous('hücre il adıyla başlıyor, şehir filtreli sayfa varsayımıyla çelişiyor');
    // locationRaw: ilçe/mahalle ayrımı sezgisel olduğu için ham metin her zaman korunur.
    return { city: loc.city, district: first || null, neighborhood: rest ?? null, locationRaw: raw };
  }
  if (!resolveCity(first)) return ambiguous('ilk sözcük il adı değil');
  return { city: first, district: rest ?? null };
}

/** Hücre metni; favori kutusu, gizli input/stil/script ve gizli elemanlar dışlanır. */
function visibleCellLines($: CheerioAPI, el: Sel): string[] {
  const copy = el.clone();
  copy
    .find('script, style, input, noscript, [hidden], [style*="display:none"], [style*="display: none"]')
    .remove();
  return cellLines($, copy);
}

function extractTotalCount($: CheerioAPI): number | null {
  const text = clean($('body').text());
  const m = text.match(/(\d[\d.]*)\s+ilan\s+bulundu/i) ?? text.match(/(\d[\d.]*)\s+ilan\b/i);
  return m ? parseTrNumber(m[1]) : null;
}

function extractPagination($: CheerioAPI): SearchPagination | null {
  const set = new Set<number>();
  $('ul.pageNaviButtons a[href]').each((_, a) => {
    const m = ($(a).attr('href') ?? '').match(/[?&]pagingOffset=(\d+)/);
    if (m) set.add(Number(m[1]));
  });
  if (set.size === 0) return null;
  const offsets = [...set].sort((x, y) => x - y);
  const pageSize = offsets.find((o) => o > 0) ?? null;
  return { offsets, pageSize };
}

export function parseSearchPage(html: string, ctx: ParseContext): SearchParseResult {
  const $ = load(html);
  const warnings: string[] = [];
  const location = detectLocationContext($, html, ctx);

  // Başlık hücrelerinden sütun indeksleri (gerçek sayfada thead gözlemlenemedi; yoksa sınıflara düşer)
  const colIndex: Partial<Record<SearchField, number>> = {};
  const headRow = $('#searchResultsTable thead tr, table thead tr').first();
  headRow.children('th, td').each((i, el) => {
    const key = foldTr($(el).text()).replace(/\s*\/\s*/g, '/');
    const field = HEADER_MAP[key];
    if (field && colIndex[field] === undefined) colIndex[field] = i;
  });

  const items: ListingSummary[] = [];
  $('tr.searchResultsItem').each((_, row) => {
    const $row = $(row);
    const id = $row.attr('data-id');
    if (!id) return; // reklam / native satır

    const cells = $row.children('td');
    const tagCells = $row.children('td.searchResultsTagAttributeValue');
    const attrCells = $row.children('td.searchResultsAttributeValue');
    const get = (field: SearchField): Sel | null => {
      const idx = colIndex[field];
      if (idx !== undefined && cells.get(idx)) return $(cells.get(idx)!);
      // başlık yoksa konuma/sınıfa göre: etiket hücresi 1 ise model, 2 ise seri+model
      if (field === 'series') return tagCells.length >= 2 ? $(tagCells.get(0)!) : null;
      if (field === 'model') {
        if (tagCells.length >= 2) return $(tagCells.get(1)!);
        return tagCells.length === 1 ? $(tagCells.get(0)!) : null;
      }
      // 3 searchResultsAttributeValue: yıl, km, renk
      if (field === 'year' || field === 'km' || field === 'color') {
        const n = field === 'year' ? 0 : field === 'km' ? 1 : 2;
        return attrCells.get(n) ? $(attrCells.get(n)!) : null;
      }
      const sel = CLASS_FALLBACK[field];
      if (sel) {
        const found = $row.find(sel).first();
        if (found.length) return found;
      }
      return null;
    };
    const lines = (field: SearchField): string[] => {
      const c = get(field);
      return c ? visibleCellLines($, c) : [];
    };
    const text = (field: SearchField): string | null => lines(field).join(' ') || null;

    // URL: önce thumbnail bağlantısı (başlık href'i "#" olabilir), sonra başlık bağlantısı
    const titleLink = $row.find('a.classifiedTitle').first();
    const thumbLink = $row.find('td.searchResultsLargeThumbnail a[href^="/ilan/"]').first();
    const anyIlan = $row.find('a[href^="/ilan/"]').first();
    let url = absUrl(thumbLink.attr('href')) ?? absUrl(anyIlan.attr('href')) ?? absUrl(titleLink.attr('href'));
    if (!url) {
      url = `${SITE}/ilan/${id}/detay`;
      warnings.push(`${id}: ilan bağlantısı bulunamadı, URL üretildi`);
    }
    const title =
      clean(titleLink.text()) ||
      clean($row.find('td.searchResultsLargeThumbnail a[title]').first().attr('title')) ||
      text('title') ||
      '';

    const priceText = text('price');
    const price = parseTrNumber(priceText);
    if (price === null) warnings.push(`${id}: fiyat okunamadı`);

    const place = parseLocation(lines('location'), location, id);
    if (place.warning) warnings.push(place.warning);

    items.push({
      id,
      url,
      title,
      brand: null,
      series: text('series'),
      model: text('model'),
      year: parseTrNumber(text('year')),
      km: parseTrNumber(text('km')),
      color: text('color'),
      price,
      currency: parseCurrency(priceText),
      city: place.city,
      district: place.district,
      ...(place.neighborhood !== undefined ? { neighborhood: place.neighborhood } : {}),
      ...(place.locationRaw !== undefined ? { locationRaw: place.locationRaw } : {}),
      listingDate: parseTrDate(text('date')),
      transmission: null,
      fuel: null,
      source: 'search',
      capturedAt: ctx.capturedAt,
    });
  });

  if (items.length === 0) warnings.push('arama sayfasında ilan satırı bulunamadı');
  return { items, warnings, totalCount: extractTotalCount($), pagination: extractPagination($), location };
}

// ---------- ilan detay sayfası ----------

/**
 * Gerçek sayfada <dl><dt>etiket</dt><dd>değer</dd>; sayfada başka dl/dt blokları da var
 * (giriş formu, satıcı kutusu) → yalnızca bilinen etiketler alınır.
 */
const KNOWN_DT_LABELS = new Set([
  'ilan no', 'ilan tarihi', 'marka', 'seri', 'model', 'yil', 'yakit / motor tipi', 'yakit',
  'vites', 'arac durumu', 'km', 'kilometre', 'kasa tipi', 'motor gucu', 'motor hacmi', 'cekis',
  'renk', 'servis garantisi', 'garanti', 'agir hasar kayitli', 'plaka / uyruk', 'kimden', 'takas',
  'tramer',
]);

function extractAttributes($: CheerioAPI): Record<string, string> {
  const attrs: Record<string, string> = {};
  // eski/sentetik yapı: ul.classifiedInfoList > li > strong + span
  $('.classifiedInfoList li').each((_, li) => {
    const label = clean($(li).find('strong').first().text());
    const value = clean($(li).find('span').first().text());
    if (!label || PRIVATE_LABELS.has(foldTr(label))) return;
    attrs[label] = value;
  });
  // gerçek yapı: dt (baş/son boşluklu) + sonraki dd
  $('dt').each((_, dt) => {
    const label = clean($(dt).text());
    const key = foldTr(label);
    if (!label || PRIVATE_LABELS.has(key) || !KNOWN_DT_LABELS.has(key)) return;
    if (label in attrs) return;
    const dd = $(dt).nextAll('dd').first();
    if (!dd.length) return;
    const copy = dd.clone();
    copy.find('script, style, input, [hidden], [style*="display:none"], [style*="display: none"]').remove();
    attrs[label] = clean(copy.text());
  });
  return attrs;
}

const DAMAGE_CLASS_STATUS: Record<string, PartStatus> = {
  original: 'original',
  'local-painted-new': 'local-painted',
  'painted-new': 'painted',
  'changed-new': 'changed',
};
/** Metin kısaltmaları (varsayım, doğrulanmadı): B boyalı, D değişen, L lokal boyalı. */
const DAMAGE_TEXT_STATUS: Record<string, PartStatus> = {
  B: 'painted',
  D: 'changed',
  L: 'local-painted',
};

/** .damage-area: lejant (.car-damage-info) hariç, durum sınıfı taşıyan her eleman bir parçadır. */
function extractDamageArea($: CheerioAPI, warnings: string[]): { part: string; status: PartStatus }[] | null {
  const area = $('.damage-area').first();
  if (!area.length) return null;
  const out: { part: string; status: PartStatus }[] = [];
  let textFallback = false;
  area.find('*').each((_, el) => {
    const $el = $(el);
    if ($el.closest('.car-damage-info').length) return;
    const classes = ($el.attr('class') ?? '').split(/\s+/).filter(Boolean);
    const statusClass = classes.find((c) => c in DAMAGE_CLASS_STATUS);
    const rest = classes.filter((c) => !(c in DAMAGE_CLASS_STATUS));
    if (statusClass) {
      if (rest[0]) out.push({ part: rest[0], status: DAMAGE_CLASS_STATUS[statusClass]! });
      return;
    }
    const t = clean($el.text());
    if (rest.length === 1 && t in DAMAGE_TEXT_STATUS && $el.children().length === 0) {
      out.push({ part: rest[0]!, status: DAMAGE_TEXT_STATUS[t]! });
      textFallback = true;
    }
  });
  if (textFallback) warnings.push('hasar durumu metin kısaltmasından okundu (doğrulanmadı)');
  return out.length ? out : null;
}

function extractDamage($: CheerioAPI): { part: string; status: PartStatus }[] | null {
  const out: { part: string; status: PartStatus }[] = [];
  let found = false;
  $('h2, h3, h4').each((_, h) => {
    const t = foldTr($(h).text());
    let status: PartStatus | null = null;
    if (t.includes('lokal boyali')) status = 'local-painted';
    else if (t.includes('boyali')) status = 'painted';
    else if (t.includes('degisen')) status = 'changed';
    if (!status) return;
    found = true;
    const list = $(h).nextAll('ul, ol').first();
    list.find('li').each((_, li) => {
      const part = clean($(li).text());
      if (part) out.push({ part, status: status! });
    });
  });
  return found ? out : null;
}

/** Fiyat metni: gizli input, "Tüm Fiyat Değişimlerini Gör" gürültüsü hariç. */
function extractPriceText($: CheerioAPI): string | null {
  const el =
    $('h3.classifiedPriceValue').first().length
      ? $('h3.classifiedPriceValue').first()
      : $('.classifiedPrice h3:not(.price-all)').first().length
        ? $('.classifiedPrice h3:not(.price-all)').first()
        : $('.classifiedInfo h3:not(.price-all)').first();
  if (!el.length) return null;
  const copy = el.clone();
  copy.find('input, script, style, .price-all').remove();
  const t = clean(copy.text());
  return t || null;
}

interface DetailLocation {
  city: string | null;
  district: string | null;
  neighborhood: string | null;
}

/**
 * Detay konumu (doğrulandı 2026-11-18): önce `a[data-click-label^="Adres Breadcrumb |"]`
 * bağlantıları (ilk = il, ikinci = ilçe, SON = mahalle; ikiden azsa eldekiler), sonra
 * `#gmap` data-* öznitelikleri, en son eski `.classifiedInfo h2 a` (sentetik yedek).
 */
function extractDetailLocation($: CheerioAPI): DetailLocation | null {
  const crumbs = $('a[data-click-label^="Adres Breadcrumb |"]')
    .toArray()
    .map((a) => clean($(a).text()))
    .filter(Boolean);
  if (crumbs.length > 0) {
    return {
      city: crumbs[0] ?? null,
      district: crumbs[1] ?? null,
      neighborhood: crumbs.length >= 3 ? crumbs[crumbs.length - 1] ?? null : null,
    };
  }
  const gmap = $('#gmap').first();
  const town = clean(gmap.attr('data-town-name') ?? '');
  const quarter = clean(gmap.attr('data-quarter-name') ?? '');
  const cityCode = clean(gmap.attr('data-city') ?? '');
  const cityName = cityCode ? resolveCity(cityCode)?.name ?? null : null;
  if (cityName || town || quarter) {
    return { city: cityName, district: town || null, neighborhood: quarter || null };
  }
  const legacy = $('.classifiedInfo h2 a')
    .toArray()
    .map((a) => clean($(a).text()))
    .filter(Boolean);
  if (legacy.length > 0) return { city: legacy[0] ?? null, district: legacy[1] ?? null, neighborhood: null };
  return null;
}

export function parseListingPage(html: string, ctx: ParseContext): Listing {
  const $ = load(html);
  const warnings: string[] = [];
  const attributes = extractAttributes($);

  // etiket (foldTr) -> değer
  const byLabel = new Map<string, string>();
  for (const [k, v] of Object.entries(attributes)) byLabel.set(foldTr(k), v);
  const attr = (label: string): string | null => byLabel.get(label) || null;

  const pageUrl = extractPageUrl($, html, ctx);
  const id = attr('ilan no') ?? idFromUrl(pageUrl);
  if (!id) throw new Error('ilan no bulunamadı');
  const url = pageUrl ?? `${SITE}/ilan/${id}/detay`;

  const title = clean($('.classifiedDetailTitle h1').first().text() || $('h1').first().text());

  const priceText = extractPriceText($);
  const price = parseTrNumber(priceText);
  const year = parseTrNumber(attr('yil'));
  const km = parseTrNumber(attr('km') ?? attr('kilometre'));
  if (price === null) warnings.push('fiyat okunamadı');
  if (year === null) warnings.push('yıl okunamadı');
  if (km === null) warnings.push('km okunamadı');

  const place = extractDetailLocation($);
  if (!place) warnings.push('konum okunamadı (adres breadcrumb ve harita öznitelikleri bulunamadı)');

  const volumeCc = parseRangeOrNumber(attr('motor hacmi'));
  const powerHp = parseRangeOrNumber(attr('motor gucu'));

  const descEl = $('#classifiedDescription').first().clone();
  descEl.find('script, style, input, [hidden], [style*="display:none"], [style*="display: none"]').remove();
  let description: string | null = clean(descEl.text()) || null;
  if (description) {
    description = description.replace(PHONE_RE, '[telefon]').slice(0, DESCRIPTION_MAX);
  }

  let tramerAmount = parseTrNumber(attr('tramer'));
  if (tramerAmount === null && description) {
    const m = description.match(/tramer[^0-9]{0,20}([\d.]+)\s*(?:tl|₺)/i);
    if (m) {
      tramerAmount = parseTrNumber(m[1]);
      if (tramerAmount !== null) warnings.push('tramer açıklamadan çıkarıldı (doğrulanmadı)');
    }
  }

  return {
    id,
    url,
    title,
    brand: attr('marka'),
    series: attr('seri'),
    model: attr('model'),
    year,
    km,
    color: attr('renk'),
    price,
    currency: parseCurrency(priceText),
    city: place?.city ?? null,
    district: place?.district ?? null,
    ...(place?.neighborhood != null ? { neighborhood: place.neighborhood } : {}),
    listingDate: parseTrDate(attr('ilan tarihi')),
    transmission: mapTransmission(attr('vites')),
    fuel: mapFuel(attr('yakit / motor tipi') ?? attr('yakit')),
    source: 'listing',
    capturedAt: ctx.capturedAt,
    engine: volumeCc !== null || powerHp !== null ? { volumeCc, powerHp } : null,
    bodyType: attr('kasa tipi'),
    drivetrain: attr('cekis'),
    vehicleCondition: attr('arac durumu'),
    sellerType: mapSellerType(attr('kimden')),
    exchange: parseYesNo(attr('takas')),
    warranty: parseYesNo(attr('servis garantisi') ?? attr('garanti')),
    heavyDamage: parseYesNo(attr('agir hasar kayitli')),
    tramerAmount,
    damage: extractDamageArea($, warnings) ?? extractDamage($),
    description,
    attributes,
    warnings,
  };
}
