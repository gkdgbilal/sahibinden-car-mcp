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

export function parseSearchPage(
  html: string,
  ctx: ParseContext,
): { items: ListingSummary[]; warnings: string[] } {
  const $ = load(html);
  const warnings: string[] = [];

  // Başlık hücrelerinden sütun indeksleri
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
    const get = (field: SearchField): Sel | null => {
      const idx = colIndex[field];
      if (idx !== undefined && cells.get(idx)) return $(cells.get(idx)!);
      const sel = CLASS_FALLBACK[field];
      if (sel) {
        const found = $row.find(sel).first();
        if (found.length) return found;
      }
      return null;
    };
    const text = (field: SearchField): string | null => {
      const c = get(field);
      if (!c) return null;
      return cellText($, c) || null;
    };

    const linkHref = $row.find('a.classifiedTitle').first().attr('href');
    let url = absUrl(linkHref);
    if (!url) {
      url = `${SITE}/ilan/${id}/detay`;
      warnings.push(`${id}: ilan bağlantısı bulunamadı, URL üretildi`);
    }
    const titleLink = $row.find('a.classifiedTitle').first();
    const title = clean(titleLink.text()) || text('title') || '';

    const priceText = text('price');
    const price = parseTrNumber(priceText);
    if (price === null) warnings.push(`${id}: fiyat okunamadı`);

    const locCell = get('location');
    const locLines = locCell ? cellLines($, locCell) : [];

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
      city: locLines[0] ?? null,
      district: locLines[1] ?? null,
      listingDate: parseTrDate(text('date')),
      transmission: null,
      fuel: null,
      source: 'search',
      capturedAt: ctx.capturedAt,
    });
  });

  if (items.length === 0) warnings.push('arama sayfasında ilan satırı bulunamadı');
  return { items, warnings };
}

// ---------- ilan detay sayfası ----------

function extractAttributes($: CheerioAPI): Record<string, string> {
  const attrs: Record<string, string> = {};
  $('.classifiedInfoList li').each((_, li) => {
    const label = clean($(li).find('strong').first().text());
    const value = clean($(li).find('span').first().text());
    if (!label || PRIVATE_LABELS.has(foldTr(label))) return;
    attrs[label] = value;
  });
  return attrs;
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

  const priceText = clean($('.classifiedInfo h3').first().text()) || null;
  const price = parseTrNumber(priceText);
  const year = parseTrNumber(attr('yil'));
  const km = parseTrNumber(attr('km'));
  if (price === null) warnings.push('fiyat okunamadı');
  if (year === null) warnings.push('yıl okunamadı');
  if (km === null) warnings.push('km okunamadı');

  const locs = $('.classifiedInfo h2 a')
    .toArray()
    .map((a) => clean($(a).text()))
    .filter(Boolean);

  const volumeCc = parseRangeOrNumber(attr('motor hacmi'));
  const powerHp = parseRangeOrNumber(attr('motor gucu'));

  let description: string | null = clean($('#classifiedDescription').text()) || null;
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
    city: locs[0] ?? null,
    district: locs[1] ?? null,
    listingDate: parseTrDate(attr('ilan tarihi')),
    transmission: mapTransmission(attr('vites')),
    fuel: mapFuel(attr('yakit')),
    source: 'listing',
    capturedAt: ctx.capturedAt,
    engine: volumeCc !== null || powerHp !== null ? { volumeCc, powerHp } : null,
    bodyType: attr('kasa tipi'),
    drivetrain: attr('cekis'),
    vehicleCondition: attr('arac durumu'),
    sellerType: mapSellerType(attr('kimden')),
    exchange: parseYesNo(attr('takas')),
    warranty: parseYesNo(attr('garanti')),
    heavyDamage: parseYesNo(attr('agir hasar kayitli')),
    tramerAmount,
    damage: extractDamage($),
    description,
    attributes,
    warnings,
  };
}
