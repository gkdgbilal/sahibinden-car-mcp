import { z } from 'zod';
import { computeMarketStats } from '../analytics/market.js';
import { parseRef } from '../providers/provider.js';
import { SearchQuerySchema } from '../sahibinden/types.js';
import type { ToolDeps } from './deps.js';

export const MARKET_STATS_DESCRIPTION =
  'Yerel store\'daki ilan (istek) fiyatlarından segment istatistiği (medyan, çeyrekler, P10/P90, n) ve verilen araç için emsal bandı ile ' +
  'fiyat konumunu (yüzdelik, medyana göre %) hesaplar. Km/model yılı farkı şeffaf Theil–Sen eğimleriyle düzeltilir; hasar/boya/tramer ' +
  'düzeltmeye girmez, ayrı tablolarda raporlanır. İki kullanım: target.ref ile store\'daki bir ilanın konumu, ya da target.year+km(+price) ' +
  'ile kendi aracınız için emsal bandı. confidence alanını kullanıcıya AYNEN aktar; insufficient/low ise kesin yorum yapma. ' +
  'İstek fiyatı satış fiyatı değildir. Sonuçlar yalnızca kullanıcının kaydettiği sayfalara dayanır. İnternete bağlanmaz.';

export const DamageGroupSchema = z.enum(['clean', 'painted', 'replaced', 'heavy', 'unknown']);

const SegmentSchema = SearchQuerySchema.pick({
  city: true, brand: true, models: true, yearMin: true, yearMax: true, kmMin: true, kmMax: true,
  transmission: true, fuel: true, sellerType: true, bodyType: true, enginePower: true, engineVolume: true,
}).extend({ category: z.string().regex(/^[a-z0-9.\-]+$/).max(80).optional() });

const TargetSchema = z
  .object({
    /** İlan no / URL (store'da olmalı). */
    ref: z.string().min(3).max(2000).optional(),
    year: z.number().int().min(1950).max(2100).optional(),
    km: z.number().int().min(0).max(2_000_000).optional(),
    /** TL; yoksa yalnızca emsal bandı hesaplanır. */
    price: z.number().int().positive().optional(),
    /** '111. Yıl' (yalnızca bilgi satırı). */
    trim: z.string().max(60).optional(),
    damage: DamageGroupSchema.optional(),
    tramerAmount: z.number().int().min(0).optional(),
  })
  .refine((t) => t.ref !== undefined || (t.year !== undefined && t.km !== undefined), {
    message: 'target için ref ya da year+km gerekli',
  });

export const marketStatsInput = z.object({
  segment: SegmentSchema.optional(),
  target: TargetSchema.optional(),
  damagePolicy: z.enum(['match-target', 'clean', 'any']).default('match-target'),
  maxAgeDays: z.number().int().min(1).max(365).default(60),
  minSample: z.number().int().min(5).max(50).default(8),
  adjust: z.enum(['auto', 'none']).default('auto'),
  comparables: z.number().int().min(0).max(30).default(10),
});

const Dist = z.object({
  n: z.number(),
  min: z.number(),
  p10: z.number().nullable(),
  q1: z.number().nullable(),
  median: z.number(),
  q3: z.number().nullable(),
  p90: z.number().nullable(),
  max: z.number(),
  iqrPct: z.number().nullable(),
});

export const marketStatsOutput = z.object({
  segmentUsed: SegmentSchema,
  method: z.object({
    basis: z.enum(['adjusted', 'narrow-band', 'raw-segment']),
    kmSlopePctPer10k: z.number().nullable(),
    yearSlopePct: z.number().nullable(),
    kmPairs: z.number(),
    yearPairs: z.number(),
    window: z.object({ years: z.number(), km: z.number() }),
    /** İnsan okunur yöntem açıklaması (her adım bir cümle). */
    steps: z.array(z.string()),
  }),
  sample: z.object({
    candidates: z.number(),
    used: z.number(),
    withUnknownFields: z.number(),
    excluded: z.record(z.string(), z.number()),
    observationAgeDays: z.object({ median: z.number(), max: z.number() }),
    damageEvidence: z.object({ detail: z.number(), searchFilter: z.number(), none: z.number() }),
    evidenceConflicts: z.number(),
    damagePolicyFallback: z.boolean(),
    coverage: z.array(
      z.object({ searchKey: z.string(), seen: z.number(), totalCount: z.number().nullable(), sorting: z.string().nullable() }),
    ),
  }),
  raw: Dist.nullable(),
  basisDistribution: Dist.nullable(),
  target: z
    .object({
      source: z.enum(['ref', 'input']),
      id: z.string().optional(),
      year: z.number().nullable(),
      km: z.number().nullable(),
      price: z.number().nullable(),
      damage: DamageGroupSchema,
      tramer: z.string().nullable(),
      fairBand: z
        .object({
          p10: z.number().nullable(),
          q1: z.number().nullable(),
          median: z.number(),
          q3: z.number().nullable(),
          p90: z.number().nullable(),
        })
        .nullable(),
      position: z
        .object({
          percentile: z.number(),
          vsMedianPct: z.number(),
          band: z.enum(['well-below', 'below', 'typical', 'above', 'well-above']),
          text: z.string(),
        })
        .nullable(),
    })
    .nullable(),
  sameTrim: z.object({ trim: z.string(), n: z.number(), median: z.number().nullable() }).nullable(),
  damageBreakdown: z.array(
    z.object({
      group: DamageGroupSchema,
      n: z.number(),
      median: z.number().nullable(),
      vsCleanMedianPct: z.number().nullable(),
      evidence: z.object({ detail: z.number(), searchFilter: z.number() }),
    }),
  ),
  tramerBreakdown: z.array(z.object({ bucket: z.string(), n: z.number(), median: z.number().nullable() })),
  comparables: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      year: z.number().nullable(),
      km: z.number().nullable(),
      price: z.number(),
      adjustedPrice: z.number().nullable(),
      damage: DamageGroupSchema,
      lastSeenAt: z.string(),
    }),
  ),
  confidence: z.object({
    level: z.enum(['insufficient', 'low', 'medium', 'high']),
    summary: z.string(),
    reasons: z.array(z.string()),
  }),
  warnings: z.array(z.string()),
});

export async function marketStatsHandler(
  input: z.infer<typeof marketStatsInput>,
  deps: Pick<ToolDeps, 'store' | 'now'>,
): Promise<z.infer<typeof marketStatsOutput>> {
  const hasSegment =
    input.segment !== undefined &&
    Object.values(input.segment).some((v) => v !== undefined && !(Array.isArray(v) && v.length === 0));
  const ref = input.target?.ref;
  if (!hasSegment && ref === undefined) {
    throw new Error('segment (en az category/brand/models) ya da target.ref gerekli');
  }
  let targetView;
  if (ref !== undefined) {
    const id = parseRef(ref);
    if (id === null) throw new Error('İlan no veya sahibinden ilan URL\'si tanınmadı.');
    targetView = deps.store.record(id);
    if (!targetView) throw new Error('İlan store\'da yok; önce sayfasını içe aktarın (get_listing hint\'ine bakın).');
  }
  const result = computeMarketStats(deps.store.records(), deps.store.searches(), input, deps.now(), {
    ...(targetView ? { targetView } : {}),
  });
  return marketStatsOutput.parse(result);
}
