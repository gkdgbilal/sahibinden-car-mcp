import { z } from 'zod';
import type { SearchQuery } from '../sahibinden/types.js';
import type { SearchOutcome } from './provider.js';

export const LiveStatusSchema = z.enum([
  'ok', 'partial', 'disabled', 'unsupported-runtime', 'not-running', 'challenge-detected', 'challenge-pending',
  'login-required', 'unexpected-page', 'timeout', 'navigation-error', 'deadline', 'hourly-cap', 'busy',
]);

export const LiveVisitSchema = z.object({
  url: z.string(),
  finalUrl: z.string().nullable(),
  pageType: z.enum(['search', 'listing', 'challenge', 'unknown']).nullable(),
  httpStatus: z.number().nullable(),
  imported: z.number(),
  ids: z.array(z.string()),
  ms: z.number(),
  skippedReason: z.string().optional(),
});

export const LiveRunSchema = z.object({
  status: LiveStatusSchema,
  message: z.string(),
  userAction: z.string().optional(),
  visits: z.array(LiveVisitSchema),
  notVisited: z.array(z.string()),
  freshIds: z.array(z.string()),
  nextAllowedAt: z.string().nullable(),
});

export const LiveListingItemSchema = z.object({
  ref: z.string(),
  id: z.string().nullable(),
  state: z.enum(['imported', 'skipped-known', 'invalid-ref', 'not-visited', 'failed']),
  reason: z.string().optional(),
});

export const BrowserStatusSchema = z.object({
  status: LiveStatusSchema,
  message: z.string(),
  enabled: z.boolean(),
  runtimeSupported: z.boolean(),
  nodeVersion: z.string(),
  profileDir: z.string(),
  chrome: z.object({ reachable: z.boolean(), version: z.string().nullable() }),
  rateLimit: z.object({
    minDelayMs: z.number(),
    maxPagesPerCall: z.number(),
    pagesLastHour: z.number(),
    hourlyCap: z.number(),
    nextAllowedAt: z.string().nullable(),
  }),
  pendingChallenge: z.object({ url: z.string(), since: z.string() }).nullable(),
});

export type LiveVisit = z.infer<typeof LiveVisitSchema>;
export type LiveRun = z.infer<typeof LiveRunSchema>;
export type LiveListingItem = z.infer<typeof LiveListingItemSchema>;
export type BrowserStatus = z.infer<typeof BrowserStatusSchema>;

export interface LiveProvider {
  /** Gezinme yapmaz. */
  status(): Promise<BrowserStatus>;
  liveSearch(q: SearchQuery, o: { maxPages?: number }): Promise<{ outcome: SearchOutcome; live: LiveRun }>;
  liveGetListings(
    refs: string[],
    o: { maxListings?: number; skipKnown?: boolean },
  ): Promise<{ live: LiveRun; items: LiveListingItem[]; storeSize: number }>;
}
