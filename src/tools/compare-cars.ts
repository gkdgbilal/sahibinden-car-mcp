import { z } from 'zod';
import { parseRef } from '../providers/provider.js';
import { TramerStatusSchema } from '../sahibinden/types.js';
import type { Listing, ListingSummary, TramerStatus } from '../sahibinden/types.js';
import type { ToolDeps } from './deps.js';

export const COMPARE_CARS_DESCRIPTION =
  '2–10 ilanı standart alanlarla yan yana koyar; yaş, km/yıl ve set medyanına göre fiyat farkı hesaplar. Piyasa yorumu sende.';

export const compareCarsInput = z.object({ refs: z.array(z.string().max(2000)).min(2).max(10) });
export const compareCarsOutput = z.object({
  rows: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      url: z.string(),
      price: z.number().nullable(),
      year: z.number().nullable(),
      km: z.number().nullable(),
      transmission: z.string().nullable(),
      fuel: z.string().nullable(),
      ageYears: z.number().nullable(),
      kmPerYear: z.number().nullable(),
      priceVsSetMedianPct: z.number().nullable(),
      heavyDamage: z.boolean().nullable(),
      tramerAmount: z.number().nullable(),
      tramerStatus: TramerStatusSchema.nullable(),
      changedParts: z.number().nullable(),
      paintedParts: z.number().nullable(),
      completeness: z.enum(['full', 'summary']),
      notes: z.array(z.string()),
    }),
  ),
  stats: z.object({
    priceMin: z.number().nullable(),
    priceMedian: z.number().nullable(),
    priceMax: z.number().nullable(),
    count: z.number(),
  }),
  missing: z.array(z.string()),
});

type Output = z.infer<typeof compareCarsOutput>;
const isListing = (e: Listing | ListingSummary): e is Listing => 'attributes' in e;
const round1 = (n: number) => Math.round(n * 10) / 10;

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Saf hesap: yaş, km/yıl, set medyanına göre fiyat farkı, hasar sayıları. */
export function computeComparison(
  entries: (Listing | ListingSummary)[],
  nowYear: number,
): Pick<Output, 'rows' | 'stats'> {
  // Medyan yalnızca çoğunluk para birimindeki (para birimi bilinen) fiyatlardan; eşitlikte ilk görülen.
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.price !== null && e.currency !== null) counts.set(e.currency, (counts.get(e.currency) ?? 0) + 1);
  }
  let major: string | null = null;
  for (const [cur, n] of counts) if (major === null || n > counts.get(major)!) major = cur;
  const prices = entries
    .filter((e) => e.price !== null && e.currency === major)
    .map((e) => e.price as number);
  const med = median(prices);

  const rows = entries.map((e) => {
    const full = isListing(e);
    const ageYears = e.year === null ? null : Math.max(nowYear - e.year, 0);
    const damage = full ? e.damage : null;
    const tramerAmount = full ? e.tramerAmount : null;
    // Eski depolanmış kayıtlarda tramerStatus yoktur; tutardan türetilir.
    const tramerStatus: TramerStatus | null = full
      ? (e.tramerStatus ?? (e.tramerAmount !== null ? 'amount' : 'unknown'))
      : null;
    const notes: string[] = [];
    if (full && tramerAmount === null && (tramerStatus === 'mentioned' || tramerStatus === 'unknown')) {
      notes.push('tramer tutarı açıklamada belirsiz; resmi tramer sorgusu yapın');
    }
    return {
      id: e.id,
      title: e.title,
      url: e.url,
      price: e.price,
      year: e.year,
      km: e.km,
      transmission: e.transmission,
      fuel: e.fuel,
      ageYears,
      kmPerYear: e.km === null || ageYears === null ? null : Math.round(e.km / Math.max(ageYears, 1)),
      priceVsSetMedianPct:
        e.price !== null && e.currency === major && med !== null && med > 0
          ? round1((e.price / med - 1) * 100)
          : null,
      heavyDamage: full ? e.heavyDamage : null,
      tramerAmount,
      tramerStatus,
      changedParts: damage ? damage.filter((d) => d.status === 'changed').length : null,
      paintedParts: damage
        ? damage.filter((d) => d.status === 'painted' || d.status === 'local-painted').length
        : null,
      completeness: full ? ('full' as const) : ('summary' as const),
      notes,
    };
  });

  return {
    rows,
    stats: {
      priceMin: prices.length ? Math.min(...prices) : null,
      priceMedian: med,
      priceMax: prices.length ? Math.max(...prices) : null,
      count: rows.length,
    },
  };
}

export async function compareCarsHandler(
  input: z.infer<typeof compareCarsInput>,
  deps: ToolDeps,
): Promise<Output> {
  const entries: (Listing | ListingSummary)[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const ref of input.refs) {
    const id = parseRef(ref);
    if (id && seen.has(id)) continue;
    const { listing, summary } = await deps.provider.getListing(ref);
    const entry = listing ?? summary;
    if (!id || !entry) missing.push(ref);
    else {
      seen.add(id);
      entries.push(entry);
    }
  }
  return { ...computeComparison(entries, deps.nowYear()), missing };
}
