import { z } from 'zod';
import { rankListings } from '../analytics/rank.js';
import { SearchQuerySchema } from '../sahibinden/types.js';
import { DamageGroupSchema } from './market-stats.js';
import type { ToolDeps } from './deps.js';

export const RANK_CARS_DESCRIPTION =
  '"En mantıklı N ilan": yerel store\'daki ilanları filtreler (search_cars ile aynı filtreler), aynı model grubunun km/model yılı düzeltilmiş ' +
  'piyasa medyanına göre %kaç ucuz/pahalı olduğunu hesaplar, hasar/tramer/yıllık km/açıklama risk bayraklarını ekler ve puanlayıp karar verir ' +
  '(strong-candidate, fair, overpriced, check-first, risky, no-baseline). Yüksek riskli ilanlar ana listeden ayrılıp avoid altında gelir. ' +
  'Her ilan için reasons (neden) ve nextSteps (sıradaki adım: detay sayfası, ekspertiz, tramer) verilir; bunları kullanıcıya AYNEN aktar. ' +
  'groups[].confidence insufficient/low ise kesin yorum yapma. Fiyatlar istek fiyatıdır; hasar/tramer satıcı beyanıdır; alım tavsiyesi değildir. ' +
  'Veri yoksa önce search_cars\'ın searchUrls\'ini kullanıcıya kaydettir, import_listing_html ile içe aktar. İnternete bağlanmaz.';

const FILTER_KEYS = {
  city: true, brand: true, models: true, priceMin: true, priceMax: true, priceCurrency: true, transmission: true, fuel: true,
  yearMin: true, yearMax: true, kmMin: true, kmMax: true, sellerType: true, bodyType: true, color: true, vehicleCondition: true,
  enginePower: true, engineVolume: true, drivetrain: true, exchange: true, listedWithin: true, unpaintedOnly: true,
  noReplacedParts: true, noHeavyDamage: true, warranty: true, unknown: true, includeUnknown: true,
} as const;

export const rankCarsInput = SearchQuerySchema.pick(FILTER_KEYS).extend({
  /** Ana listedeki ilan sayısı. */
  top: z.number().int().min(1).max(20).default(5),
  /** Bu günden eski gözlemli ilanlar elenir. */
  maxAgeDays: z.number().int().min(1).max(365).default(30),
});

const RiskFlag = z.object({ code: z.string(), severity: z.enum(['high', 'medium', 'low']), text: z.string() });
const Ranked = z.object({
  rank: z.number(),
  id: z.string(),
  url: z.string(),
  title: z.string(),
  year: z.number().nullable(),
  km: z.number().nullable(),
  price: z.number(),
  city: z.string().nullable(),
  group: z.string(),
  adjustedPrice: z.number().nullable(),
  vsMarketPct: z.number().nullable(),
  position: z.object({ percentile: z.number(), band: z.enum(['well-below', 'below', 'typical', 'above', 'well-above']) }).nullable(),
  damage: DamageGroupSchema,
  damageEvidence: z.enum(['detail', 'search-filter', 'none']),
  tramer: z.string().nullable(),
  risks: z.array(RiskFlag),
  positives: z.array(z.string()),
  score: z.number(),
  verdict: z.enum(['strong-candidate', 'fair', 'overpriced', 'check-first', 'risky', 'no-baseline']),
  reasons: z.array(z.string()),
  nextSteps: z.array(z.string()),
});

export const rankCarsOutput = z.object({
  ranked: z.array(Ranked),
  avoid: z.array(Ranked),
  groups: z.array(
    z.object({
      group: z.string(),
      n: z.number(),
      medianAdjustedPrice: z.number().nullable(),
      refYear: z.number().nullable(),
      refKm: z.number().nullable(),
      kmSlopePctPer10k: z.number().nullable(),
      yearSlopePct: z.number().nullable(),
      confidence: z.enum(['insufficient', 'low', 'medium', 'high']),
      note: z.string(),
    }),
  ),
  considered: z.number(),
  excluded: z.record(z.string(), z.number()),
  warnings: z.array(z.string()),
});

export async function rankCarsHandler(
  input: z.infer<typeof rankCarsInput>,
  deps: Pick<ToolDeps, 'store' | 'now'>,
): Promise<z.infer<typeof rankCarsOutput>> {
  const { top, maxAgeDays, ...query } = input;
  const result = rankListings(deps.store.records(), query, { top, maxAgeDays }, deps.now());
  return rankCarsOutput.parse(result);
}
