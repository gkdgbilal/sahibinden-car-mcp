import { z } from 'zod';
import { ListingSummarySchema, SearchQuerySchema } from '../sahibinden/types.js';
import type { ToolDeps } from './deps.js';

export const SEARCH_CARS_DESCRIPTION =
  'Yerelde içe aktarılmış sahibinden.com otomobil ilanlarında filtreler ve sıralar. ' +
  'Ayrıca kullanıcının tarayıcıda açması için hazır sahibinden arama URL\'leri döner. ' +
  'Sonuç yoksa: kullanıcıya searchUrls\'i açıp sayfayı Cmd+S ile inbox klasörüne kaydetmesini söyle, sonra import_listing_html çağır. ' +
  'Yerel filtre yalnızca şehir/marka/model/fiyat/yıl/km/vites/yakıt için uygulanır; sellerType, bodyType, color, vehicleCondition, ' +
  'enginePower, engineVolume, drivetrain, exchange, listedWithin, unpaintedOnly, noReplacedParts, priceCurrency, page yalnızca searchUrls\'e yansır. ' +
  'Bu araç internete bağlanmaz.';

export const searchCarsInput = SearchQuerySchema;
export const searchCarsOutput = z.object({
  results: z.array(ListingSummarySchema.extend({ unknownFields: z.array(z.string()) })),
  totalMatched: z.number(),
  storeSize: z.number(),
  searchUrls: z.array(z.object({ label: z.string(), url: z.string(), note: z.string().optional() })),
  hint: z.string().optional(),
});

export async function searchCarsHandler(
  input: z.infer<typeof searchCarsInput>,
  deps: Pick<ToolDeps, 'provider'>,
): Promise<z.infer<typeof searchCarsOutput>> {
  return deps.provider.search(input);
}
