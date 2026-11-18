import type { Listing, ListingSummary, SearchQuery } from '../sahibinden/types.js';

export interface SearchOutcome {
  results: (ListingSummary & { unknownFields: string[] })[];
  totalMatched: number;
  storeSize: number;
  /** Yerel mağazada uygulanan filtre adları. */
  appliedFilters: string[];
  /** Yalnızca sahibinden URL'sine yansıyıp yerelde uygulanmayan filtreler (hedef: boş). */
  urlOnlyFilters: string[];
  /** Fiyat filtresi nedeniyle para birimi uyuşmadığı için elenen ilan sayısı. */
  excludedOtherCurrency: number;
  /** unknown='exclude' ile alanı bilinmediği için elenen ilan sayısı. */
  excludedUnknown: number;
  searchUrls: { label: string; url: string; note?: string }[];
  hint?: string;
}

export interface IngestInput {
  path?: string;
  html?: string;
  sourceUrl?: string;
  /** Kaydedilen arama sayfası şehir filtreliyse şehir adı; konum hücresi "İlçe Mahalle" olarak okunur. */
  cityHint?: string;
}

export interface IngestReport {
  imported: { file: string | null; pageType: 'search' | 'listing'; count: number; ids: string[] }[];
  skipped: { file: string | null; reason: string }[];
  storeSize: number;
}

export interface Provider {
  readonly name: string;
  search(q: SearchQuery): Promise<SearchOutcome>;
  getListing(ref: string): Promise<{ listing: Listing | null; summary: ListingSummary | null }>;
  ingest(input: IngestInput): Promise<IngestReport>;
  stats(): Promise<{ storeSize: number; inboxDir: string }>;
}

/** İlan no (8–12 hane) veya sahibinden ilan URL'sinden ilan no çıkarır. */
export function parseRef(ref: string): string | null {
  const s = ref.trim();
  if (/^\d{8,12}$/.test(s)) return s;
  const m = s.match(/-(\d{8,12})(?:\/detay)?(?:[/?#]|$)/) ?? s.match(/\/ilan\/(\d{8,12})(?:[/?#]|$)/);
  return m ? m[1]! : null;
}
