import { z } from 'zod';
import { VERSION } from '../config.js';

export const pingInput = z.object({ msg: z.string().max(200).optional() });
export const pingOutput = z.object({ pong: z.string(), version: z.string() });

export function pingHandler(input: z.infer<typeof pingInput>): z.infer<typeof pingOutput> {
  return { pong: input.msg ?? 'ok', version: VERSION };
}
