import { z } from 'zod';
import { BrowserStatusSchema } from '../providers/live-provider.js';
import type { ToolDeps } from './deps.js';

export const BROWSER_STATUS_DESCRIPTION =
  'Tarayıcı modunun durumunu (açık mı, adanmış Chrome bağlı mı, hız sınırı, bekleyen doğrulama) gösterir; sahibinden.com\'a gitmez. ' +
  'Canlı bir araçtan önce veya bir hata sonrası kullan. ' +
  'status "not-running" ise kullanıcı "npm run chrome" ile Chrome\'u kendisi başlatmalıdır; ' +
  '"challenge-pending" ise kullanıcı açık Chrome sekmesinde doğrulamayı kendisi geçmelidir (sen geçmeye çalışma).';

export const browserStatusInput = z.object({});
export const browserStatusOutput = BrowserStatusSchema;

export async function browserStatusHandler(
  _input: z.infer<typeof browserStatusInput>,
  deps: Pick<ToolDeps, 'live'>,
): Promise<z.infer<typeof browserStatusOutput>> {
  if (!deps.live) throw new Error('Tarayıcı modu kapalı.');
  return deps.live.status();
}
