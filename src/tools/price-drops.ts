import { z } from 'zod';
import { categoryMatches } from '../analytics/category.js';
import { detectDrop, lifecycleNote, lifecycleOf } from '../analytics/history.js';
import type { Lifecycle } from '../analytics/history.js';
import { evaluateQuery } from '../sahibinden/filter.js';
import { SearchQuerySchema } from '../sahibinden/types.js';
import type { RecordView } from '../store/schema.js';
import type { ToolDeps } from './deps.js';

export const PRICE_DROPS_DESCRIPTION =
  'Yerel store\'daki fiyat geçmişinden (ilan no bazlı, sayfa yakalama zamanına göre) son N günde düşen ilanları bulur; ' +
  'izleme listesindekiler önce gelir. includeNotSeen ile "son N gündür görülmeyen" ilanları da listeler; ' +
  'görülmeme kaldırıldı demek DEĞİLDİR (yalnızca kaydedilen sayfalara dayanır). TL dışı ilanlar hesaba katılmaz ve sayılır. İnternete bağlanmaz.';

const DropFilterSchema = SearchQuerySchema.pick({
  city: true, brand: true, models: true, yearMin: true, yearMax: true, kmMin: true, kmMax: true,
  transmission: true, fuel: true, sellerType: true,
}).extend({
  category: z.string().regex(/^[a-z0-9.\-]+$/).max(80).optional(), // 'opel-astra-1.3-cdti'
});

export const priceDropsInput = z.object({
  withinDays: z.number().int().min(1).max(365).default(30),
  minDropPct: z.number().min(0).max(90).default(3),
  minDropTl: z.number().int().min(0).max(10_000_000).default(0),
  filter: DropFilterSchema.optional(),
  watchlistOnly: z.boolean().default(false),
  includeNotSeen: z.boolean().default(false),
  notSeenDays: z.number().int().min(1).max(365).default(14),
  limit: z.number().int().min(1).max(100).default(20),
});

export const LifecycleSchema = z.object({
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  daysSinceLastSeen: z.number(),
  status: z.enum(['seen-recently', 'not-seen-recently', 'not-rechecked']),
  approximate: z.boolean(),
  /** Aynı aramanın son kaydı (varsa). */
  recheckedAt: z.string().nullable(),
});

export const priceDropsOutput = z.object({
  drops: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      url: z.string(),
      year: z.number().nullable(),
      km: z.number().nullable(),
      city: z.string().nullable(),
      currentPrice: z.number(),
      peakPrice: z.number(),
      firstPrice: z.number(),
      dropTl: z.number(),
      dropPct: z.number(),
      totalChangePct: z.number(),
      detectedBetween: z.tuple([z.string(), z.string()]),
      pricePoints: z.number(),
      reboundDrop: z.boolean(),
      watched: z.boolean(),
      note: z.string().optional(),
      lifecycle: LifecycleSchema,
      flags: z.array(z.string()),
    }),
  ),
  notSeen: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        url: z.string(),
        lastPrice: z.number().nullable(),
        watched: z.boolean(),
        lifecycle: LifecycleSchema,
        /** "kaldırılmış olabilir" uyarısı (kesin hüküm değildir). */
        note: z.string().optional(),
      }),
    )
    .optional(),
  counts: z.object({
    scanned: z.number(),
    matchedFilter: z.number(),
    withPriceChange: z.number(),
    excludedOtherCurrency: z.number(),
    excludedCurrencyChange: z.number(),
  }),
  window: z.object({ from: z.string(), to: z.string() }),
  notes: z.array(z.string()),
});

type Out = z.infer<typeof priceDropsOutput>;

const lastPriceOf = (v: RecordView): number | null => {
  for (let i = v.observations.length - 1; i >= 0; i--) {
    const p = v.observations[i]!.price;
    if (p !== null) return p;
  }
  return v.best.price;
};

export async function priceDropsHandler(
  input: z.infer<typeof priceDropsInput>,
  deps: Pick<ToolDeps, 'store' | 'now'>,
): Promise<Out> {
  const now = deps.now();
  const records = deps.store.records();
  const watch = deps.store.watchlist();
  const searches = deps.store.searches();
  const { category, ...filter } = input.filter ?? {};
  const windowStart = new Date(now.getTime() - input.withinDays * 86_400_000);

  const drops: Out['drops'] = [];
  const notSeen: NonNullable<Out['notSeen']> = [];
  let matchedFilter = 0;
  let withPriceChange = 0;
  let excludedOtherCurrency = 0;
  let excludedCurrencyChange = 0;
  let approxDrops = 0;
  let notRechecked = 0;

  for (const v of records) {
    const watched = v.id in watch;
    if (input.watchlistOnly && !watched) continue;
    if (!evaluateQuery(v.best, filter, { now }).match) continue;
    if (category !== undefined && !categoryMatches(v, searches, category)) continue;
    matchedFilter++;

    const lifecycle: Lifecycle = lifecycleOf(v, searches, now, input.notSeenDays);
    if (input.includeNotSeen) {
      if (lifecycle.status === 'not-seen-recently') {
        const n = lifecycleNote(lifecycle);
        notSeen.push({
          id: v.id, title: v.best.title, url: v.best.url, lastPrice: lastPriceOf(v), watched, lifecycle,
          ...(n ? { note: n } : {}),
        });
      } else if (lifecycle.status === 'not-rechecked') notRechecked++;
    }

    const det = detectDrop(v, now, input);
    if (det.outcome === 'other-currency') {
      excludedOtherCurrency++;
      continue;
    }
    if (det.currencyChanged) excludedCurrencyChange++;
    if (det.runCount >= 2) withPriceChange++;
    if (det.outcome !== 'drop' || !det.drop) continue;

    const d = det.drop;
    const flags = [...d.flags];
    if (lifecycle.status === 'not-seen-recently') flags.push('not-seen-recently');
    if (!v.full) flags.push('summary-only');
    if (flags.includes('approximate-dates')) approxDrops++;
    const w = watch[v.id];
    drops.push({
      id: v.id,
      title: v.best.title,
      url: v.best.url,
      year: v.best.year,
      km: v.best.km,
      city: v.best.city,
      currentPrice: d.currentPrice,
      peakPrice: d.peakPrice,
      firstPrice: d.firstPrice,
      dropTl: d.dropTl,
      dropPct: d.dropPct,
      totalChangePct: d.totalChangePct,
      detectedBetween: d.detectedBetween,
      pricePoints: d.pricePoints,
      reboundDrop: d.reboundDrop,
      watched,
      ...(w?.note ? { note: w.note } : {}),
      lifecycle,
      flags,
    });
  }

  // İzlenenler önce, sonra düşüş yüzdesi azalan, eşitlikte düşüşü daha yeni görülen önce.
  drops.sort(
    (a, b) =>
      Number(b.watched) - Number(a.watched) ||
      b.dropPct - a.dropPct ||
      (a.detectedBetween[1] < b.detectedBetween[1] ? 1 : a.detectedBetween[1] > b.detectedBetween[1] ? -1 : 0),
  );
  notSeen.sort(
    (a, b) =>
      Number(b.watched) - Number(a.watched) ||
      (a.lifecycle.lastSeenAt < b.lifecycle.lastSeenAt ? 1 : a.lifecycle.lastSeenAt > b.lifecycle.lastSeenAt ? -1 : 0),
  );

  const notes: string[] = [];
  if (records.length === 0) notes.push('Store boş; önce sayfa içe aktarın.');
  notes.push(
    'Fiyatlar ilan (istek) fiyatıdır.',
    'Yalnızca kaydettiğiniz sayfalar arasındaki değişimler görünür; arada olan değişiklikler kaçabilir.',
  );
  if (excludedOtherCurrency > 0) notes.push(`${excludedOtherCurrency} ilan TL dışı para birimiyle olduğu için hesaba katılmadı.`);
  if (approxDrops > 0) {
    notes.push('approximate-dates: tarihler eski sürümden taşınan yaklaşık içe aktarma anlarına dayanıyor; kesin değildir.');
  }
  if (input.includeNotSeen) {
    notes.push(
      'Görülmemesi ilanın yayından kalktığını göstermez: yalnızca kaydedilen sayfalara dayanır. "Görülmedi" ancak aynı arama sonradan ' +
        'tekrar kaydedildiyse söylenir.',
    );
    if (notRechecked > 0) {
      notes.push(
        `${notRechecked} ilan son ${input.notSeenDays} gündür görülmedi ancak aynı arama sonradan kaydedilmediği ` +
          '(ya da arama bağlamı bilinmediği) için durumları bilinmiyor; listelenmedi.',
      );
    }
  }

  return {
    drops: drops.slice(0, input.limit),
    ...(input.includeNotSeen ? { notSeen: notSeen.slice(0, input.limit) } : {}),
    counts: { scanned: records.length, matchedFilter, withPriceChange, excludedOtherCurrency, excludedCurrencyChange },
    window: { from: windowStart.toISOString(), to: now.toISOString() },
    notes,
  };
}
