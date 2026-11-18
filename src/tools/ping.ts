import { z } from 'zod';
import { VERSION } from '../config.js';
import type { ToolDeps } from './deps.js';

export const PING_DESCRIPTION =
  'Sağlık kontrolü: sürüm, aktif provider, yerel store\'daki ilan sayısı, inbox klasörü ve tarayıcı modu durumu (browserMode).';

export const pingInput = z.object({ msg: z.string().max(200).optional() });
export const pingOutput = z.object({
  pong: z.string(),
  version: z.string(),
  provider: z.string(),
  storeSize: z.number(),
  inboxDir: z.string(),
  browserMode: z.enum(['disabled', 'enabled']),
});

export async function pingHandler(
  input: z.infer<typeof pingInput>,
  deps: Pick<ToolDeps, 'provider' | 'live'>,
): Promise<z.infer<typeof pingOutput>> {
  const stats = await deps.provider.stats();
  return { pong: input.msg ?? 'ok', version: VERSION, provider: deps.provider.name, ...stats, browserMode: deps.live ? 'enabled' : 'disabled' };
}
