import { slugify } from '../sahibinden/url-builder.js';
import type { RecordView, SearchInfo } from '../store/schema.js';

// Kategori (sahibinden arama yolu, ör. 'opel-astra-1.3-cdti') eşleşmesi (docs/08 §4.2 Adım 0). Saf, sezgisel.

const underPrefix = (full: string, prefix: string): string | null => {
  if (prefix === '') return null;
  if (full === prefix) return '';
  return full.startsWith(`${prefix}-`) ? full.slice(prefix.length + 1) : null;
};

/**
 * (i) ilanın herhangi bir arama gözleminin kategorisi eşitse; ya da
 * (ii) kayıtta slugify(marka + ' ' + seri) kategorinin öneki ve kalan kısım (ör. '1.3-cdti')
 * slugify(model)'in öneki ise (sınır '-' ile). Marka/seri yoksa yalnızca (i).
 */
export function categoryMatches(
  view: Pick<RecordView, 'best' | 'observations'>,
  searches: Readonly<Record<string, SearchInfo>>,
  category: string,
): boolean {
  const want = category.toLowerCase();
  for (const o of view.observations) {
    if (o.searchKey !== undefined && searches[o.searchKey]?.category === want) return true;
  }
  const { brand, series, model } = view.best;
  if (!brand || !series) return false;
  const rest = underPrefix(want, slugify(`${brand} ${series}`));
  if (rest === null) return false;
  if (rest === '') return true;
  return model ? underPrefix(slugify(model), rest) !== null : false;
}
