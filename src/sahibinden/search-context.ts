import type { UrlFilterFlag } from '../store/schema.js';
import { HEAVY_DAMAGE_IDS, PARAMS } from './url-schema.js';

// Arama sayfasının aday URL'lerinden arama bağlamı (docs/08 §2.3). Saf: ağ/saat/dosya yok.

/** Arama kimliğine girmeyen gürültü parametreleri. */
const NOISE_PARAMS: ReadonlySet<string> = new Set(['pagingOffset', 'sorting', 'viewType', 'pagingSize']);

/** Kategori olarak sayılmayan genel yol başlıkları. */
const GENERIC_CATEGORIES: ReadonlySet<string> = new Set(['otomobil']);

export interface SearchContext {
  /** `path?<sıralı sorgu>`; sorgu hiçbir adayda yoksa `path?*`. */
  searchKey: string;
  path: string;
  category: string | null;
  /** Yalnızca URL'de POZİTİF görülen filtreler. */
  filters: UrlFilterFlag[];
  sorting: string | null;
  /** Sorgu dizesi en az bir adayda görüldü mü (false: parametre görünmemesi "filtresiz" demek değildir). */
  filtersKnown: boolean;
}

function parseUrl(raw: string): URL | null {
  try {
    const u = new URL(raw, 'https://www.sahibinden.com');
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

function normalizePath(pathname: string): string {
  const p = pathname.toLowerCase().replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

/** Gürültü atılmış, ada göre sıralı sorgu çiftleri. */
function normalizedPairs(u: URL): [string, string][] {
  const pairs: [string, string][] = [];
  for (const [k, v] of u.searchParams) if (!NOISE_PARAMS.has(k)) pairs.push([k, v]);
  return pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
}

/**
 * `urls` = parser'ın topladığı adaylar (saved-from, sourceUrl, og:url, canonical, sayfalama href'leri).
 * Geçerli aday yoksa null. Filtre yalnızca pozitif görüldüğünde kanıt sayılır.
 */
export function searchContextOf(urls: readonly string[]): SearchContext | null {
  const parsed = urls.map(parseUrl).filter((u): u is URL => u !== null);
  if (parsed.length === 0) return null;

  const path = normalizePath(parsed[0]!.pathname);
  const first = path.split('/').filter(Boolean)[0] ?? null;
  const category = first && !GENERIC_CATEGORIES.has(first) ? first : null;

  let pairs: [string, string][] | null = null;
  let sorting: string | null = null;
  const flags = new Set<UrlFilterFlag>();
  for (const u of parsed) {
    const q = u.searchParams;
    if (sorting === null) sorting = q.get(PARAMS.sorting.key);
    if (q.get(PARAMS.unpainted.key) === 'true') flags.add('unpainted');
    if (q.get(PARAMS.noReplacedParts.key) === 'true') flags.add('noReplaced');
    if (q.get(PARAMS.heavyDamage.key) === HEAVY_DAMAGE_IDS.no) flags.add('noHeavyDamage');
    if (pairs === null) {
      const p = normalizedPairs(u);
      if (p.length > 0) pairs = p;
    }
  }

  const filtersKnown = pairs !== null;
  const query = pairs ? new URLSearchParams(pairs).toString() : '*';
  const order: UrlFilterFlag[] = ['unpainted', 'noReplaced', 'noHeavyDamage'];
  return {
    searchKey: `${path}?${query}`,
    path,
    category,
    filters: order.filter((f) => flags.has(f)),
    sorting,
    filtersKnown,
  };
}
