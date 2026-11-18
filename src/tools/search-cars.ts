import { z } from 'zod';
import { ListingSummarySchema, SearchQuerySchema } from '../sahibinden/types.js';
import type { ToolDeps } from './deps.js';

export const SEARCH_CARS_DESCRIPTION =
  'Yerelde içe aktarılmış sahibinden.com otomobil ilanlarında filtreler ve sıralar. ' +
  'Ayrıca kullanıcının tarayıcıda açması için hazır sahibinden arama URL\'leri döner. ' +
  'Sonuç yoksa: kullanıcıya searchUrls\'i açıp sayfayı Cmd+S ile inbox klasörüne kaydetmesini söyle, sonra import_listing_html çağır. ' +
  'Tüm filtreler hem sahibinden URL\'sine hem yerel mağazadaki ilanlara uygulanır (page: yalnızca URL; sort/limit: yalnızca yerel). ' +
  'Fiyat (priceMin/priceMax) priceCurrency (varsayılan TL) cinsindendir; farklı para birimli ilan elenir (dönüşüm yok) ve excludedOtherCurrency sayılır. ' +
  'Detay alanları (kasa, çekiş, hasar, motor, takas, garanti...) yalnızca detay sayfası içe aktarılmış ilanlarda bilinir; ' +
  'unknown=include (varsayılan) bilinmeyen alanlı ilanı unknownFields ile işaretleyerek döner, unknown=exclude eler (excludedUnknown). ' +
  'appliedFilters yerelde uygulanan filtreleri, urlOnlyFilters yalnızca URL\'ye yansıyanları listeler. ' +
  'Bu araç internete bağlanmaz.';

export const searchCarsInput = SearchQuerySchema;
export const searchCarsOutput = z.object({
  results: z.array(ListingSummarySchema.extend({ unknownFields: z.array(z.string()) })),
  totalMatched: z.number(),
  storeSize: z.number(),
  appliedFilters: z.array(z.string()),
  urlOnlyFilters: z.array(z.string()),
  excludedOtherCurrency: z.number(),
  excludedUnknown: z.number(),
  searchUrls: z.array(z.object({ label: z.string(), url: z.string(), note: z.string().optional() })),
  hint: z.string().optional(),
});

export async function searchCarsHandler(
  input: z.infer<typeof searchCarsInput>,
  deps: Pick<ToolDeps, 'provider'>,
): Promise<z.infer<typeof searchCarsOutput>> {
  return deps.provider.search(input);
}
