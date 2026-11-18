import { z } from 'zod';
import { MAX_HTML_ARG } from '../config.js';
import type { ToolDeps } from './deps.js';

export const IMPORT_LISTING_HTML_DESCRIPTION =
  'Kullanıcının tarayıcıdan kaydettiği sahibinden arama/ilan sayfalarını (.html) içe aktarır. ' +
  'path verilmezse inbox klasöründeki yeni dosyaları işler; path yalnızca inbox içinde olabilir (göreli yol inbox\'a göre çözülür). ' +
  'Büyük HTML\'i html argümanına koyma; path kullan.';

export const importListingHtmlInput = z.object({
  path: z.string().max(1000).optional(),
  html: z.string().max(MAX_HTML_ARG).optional(),
  sourceUrl: z.url().optional(),
});
export const importListingHtmlOutput = z.object({
  imported: z.array(
    z.object({
      file: z.string().nullable(),
      pageType: z.enum(['search', 'listing']),
      count: z.number(),
      ids: z.array(z.string()),
    }),
  ),
  skipped: z.array(z.object({ file: z.string().nullable(), reason: z.string() })),
  storeSize: z.number(),
});

export async function importListingHtmlHandler(
  input: z.infer<typeof importListingHtmlInput>,
  deps: Pick<ToolDeps, 'provider'>,
): Promise<z.infer<typeof importListingHtmlOutput>> {
  if (input.path !== undefined && input.html !== undefined) {
    throw new Error('path ve html birlikte verilemez; yalnızca birini kullanın.');
  }
  return deps.provider.ingest(input);
}
