import { parseRef } from '../providers/provider.js';
import { LISTING_URL } from '../sahibinden/url-schema.js';
import { BrowserError } from './errors.js';

export const ALLOWED_HOSTS: readonly string[] = ['www.sahibinden.com'];

/**
 * Tarayıcının gidebileceği tek yer: https ve izinli host (varsayılan www.sahibinden.com).
 * Kullanıcı bilgisi (user@), özel port ve başka hostlar reddedilir.
 */
export function assertAllowedUrl(url: string, allowedHosts: readonly string[] = ALLOWED_HOSTS): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new BrowserError('unexpected-page', 'Geçersiz URL; tarayıcı yalnızca sahibinden.com adreslerine gider');
  }
  if (u.protocol !== 'https:' || !allowedHosts.includes(u.hostname) || u.username || u.password || u.port) {
    throw new BrowserError('unexpected-page', 'Tarayıcı yalnızca https://www.sahibinden.com adreslerine gider');
  }
  return u;
}

function allowedListingPath(url: string): URL | null {
  try {
    const u = assertAllowedUrl(url);
    return u.pathname.startsWith('/ilan/') ? u : null;
  } catch {
    return null;
  }
}

/**
 * İlan no veya ilan URL'sinden gezilecek detay URL'si. Geçersizse null.
 * `knownUrl`: mağazada bilinen (slug'lı) URL; izinli değilse yedek `/ilan/<id>/detay` kullanılır.
 */
export function listingUrlFor(
  ref: string,
  knownUrl: (id: string) => string | null,
): { id: string; url: string } | null {
  const id = parseRef(ref);
  if (!id) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref.trim())) {
    const u = allowedListingPath(ref.trim());
    return u ? { id, url: `${u.origin}${u.pathname}` } : null;
  }
  const known = knownUrl(id);
  const ku = known ? allowedListingPath(known) : null;
  return { id, url: ku ? `${ku.origin}${ku.pathname}` : LISTING_URL(id) };
}
