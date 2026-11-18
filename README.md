# sahibinden-car-mcp

> **TR özet:** Sahibinden.com otomobil ilanlarını, *sizin kendi tarayıcınızda kaydettiğiniz* HTML sayfalarından okuyup Claude'a (MCP üzerinden) filtreleme, ilan detayı ve karşılaştırma araçları sunan yerel bir MCP sunucusu. sahibinden.com'a **hiçbir ağ isteği göndermez**, bot korumasını atlatmaz, hesap/cookie istemez. sahibinden.com ile resmi bir ilişkisi **yoktur**.

A local [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets Claude search, inspect and compare used-car listings from sahibinden.com, working only from pages **you saved yourself** in your own browser.

> **Disclaimer / Yasal uyarı**
> This project is **not affiliated with, endorsed by, or officially connected to sahibinden.com** in any way. It is intended for **personal, non-commercial use only**. sahibinden-car-mcp makes **no network requests to sahibinden.com**; it only parses, locally, pages you opened and saved to your own computer. It does not bypass bot protection and does not ask for or store any session information or cookies. Do not use it for bulk data collection, republishing or commercial purposes. Complying with sahibinden.com's terms of use is your own responsibility. Sellers' personal data (name, phone) is not processed. This is not legal advice.
>
> Bu proje sahibinden.com ile bağlantılı değildir, onaylanmamıştır ve sahibinden.com ile resmi bir ilişkisi yoktur. Yalnızca **kişisel, ticari olmayan** kullanım içindir. sahibinden-car-mcp sahibinden.com'a **hiçbir ağ isteği göndermez**; yalnızca sizin kendi tarayıcınızda açıp bilgisayarınıza kaydettiğiniz sayfaları yerel olarak okur. Bot korumasını atlatmaz, oturum bilgisi/cookie istemez veya saklamaz. Toplu veri toplama, yeniden yayınlama ve ticari kullanım için kullanmayın. sahibinden.com kullanım koşullarına uymak kullanıcının sorumluluğundadır. Satıcıların kişisel verileri (ad, telefon) işlenmez. Bu bir hukuki görüş değildir.

## Why it does not scrape directly

sahibinden.com is protected by Cloudflare's managed challenge (HTTP 403 with `cf-mitigated: challenge`, even for `robots.txt`). Plain HTTP requests cannot get listing data, and this project deliberately does **not** try to get around that: no proxies, no headless/stealth browsers, no captcha solvers, no fingerprint spoofing, and no copying of your browser cookies (such as `cf_clearance`) into the tool.

Instead it uses an **inbox-based import flow**: you view the page in your normal browser as any user would, save it with `Cmd+S` (`Ctrl+S` on Windows/Linux), and the MCP server parses the saved file locally. The server never touches the network.

## How it works

```
Your browser (Chrome/Firefox)                 sahibinden-car-mcp (local, stdio)
  open a search / listing page  ── Cmd+S ──▶  ~/.sahibinden-car-mcp/inbox/*.html
                                                       │  import_listing_html
                                                       ▼
                                        parser (label-based, cheerio) ──▶ local store.json
                                                       │
                                  search_cars · get_listing · compare_cars · ping
```

1. Ask Claude for a search. `search_cars` returns matching listings from your local store plus ready-made sahibinden search URL(s) for you to open.
2. Open the URL in your own browser.
3. Save the page with `Cmd+S` (format: "Webpage, Complete" or "HTML only") into `~/.sahibinden-car-mcp/inbox/`.
4. Tell Claude to import it. `import_listing_html` parses the new files, then you can search, open details and compare.

Search result rows usually do not show transmission or fuel. Save the individual listing page to get the full details (damage, paint/replaced parts, tramer, description and more).

## Requirements and installation

- Node.js 20 or newer
- npm

```bash
git clone <repository-url> sahibinden-car-mcp
cd sahibinden-car-mcp
npm install
npm run build
```

## Connecting to Claude Code

Use the absolute path of the built entry point:

```bash
claude mcp add sahibinden-car --scope user -- node /ABSOLUTE/PATH/TO/sahibinden-car-mcp/dist/index.js
claude mcp list   # sahibinden-car should show as connected
```

To use a different data directory:

```bash
claude mcp add sahibinden-car --scope user -e SAHIBINDEN_MCP_HOME=/path/to/data -- node /ABSOLUTE/PATH/TO/sahibinden-car-mcp/dist/index.js
```

For Claude Desktop, add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sahibinden-car": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/sahibinden-car-mcp/dist/index.js"]
    }
  }
}
```

## Tools

| Tool | Purpose | Main parameters |
|---|---|---|
| `search_cars` | Filters and sorts imported listings; also returns sahibinden search URLs for you to open in your browser. Listings with missing filter fields are returned with an `unknownFields` marker instead of being silently dropped. | `city`, `brand`, `models[]` (max 10), `priceMin`, `priceMax`, `transmission` (`manual`/`automatic`/`semi-automatic`), `fuel` (`gasoline`/`diesel`/`lpg`/`hybrid`/`electric`), `yearMin`, `yearMax`, `kmMin`, `kmMax`, `sort` (`price_asc` default, `price_desc`, `year_desc`, `km_asc`, `date_desc`), `limit` (1-100, default 20), `includeUnknown` (default true) |
| `get_listing` | Full details of an imported listing (damage, paint/replaced parts, tramer, description, seller type). If only a search row is stored it returns a summary plus a hint to save the detail page. | `ref` (listing number or listing URL) |
| `compare_cars` | Puts 2-10 listings side by side with age, km per year and price difference versus the set median. Market interpretation is left to Claude. | `refs[]` (2-10 listing numbers or URLs) |
| `import_listing_html` | Imports saved sahibinden search/listing pages. Without `path` it processes new files in the inbox; `path` must be inside the inbox (relative paths resolve against it). Detects half-loaded or challenge pages and reports them as skipped. | `path`, `html` (small snippets only, max 5 MB), `sourceUrl` |
| `ping` | Health check: version, active provider, number of listings in the local store, inbox directory. | `msg` (optional) |

The listing `description` field is free text written by the seller and is treated as untrusted; the tool descriptions tell the model not to follow instructions found in it.

## Example prompts

- "Find Golf/Astra/Focus/Megane in Samsun, 700-900k TL, automatic, 2015 or newer, under 150k km. Sort by price/km/year and flag the ones more than 10% below the market."
  (Turkish: "Samsun'da 700-900 bin TL, otomatik, 2015+, 150 bin km altı Golf/Astra/Focus/Megane bul; fiyat/km/yıl oranına göre sırala; piyasanın %10 altındakileri işaretle.")
- "I saved two pages into the inbox, import them."
- "Compare these three listings and tell me which one has the least damage history."
- "Show the full details for listing 1234567890."

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SAHIBINDEN_MCP_HOME` | `~/.sahibinden-car-mcp` | Data directory (contains `inbox/` and `store.json`) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. Logs go to stderr only; stdout is reserved for the MCP protocol |

Built-in limits: saved files up to 10 MB, `html` argument up to 5 MB, descriptions truncated to 4000 characters.

## Where your data is stored

Everything stays on your machine, under `SAHIBINDEN_MCP_HOME`:

- `inbox/` : the pages you saved
- `store.json` : parsed listings, de-duplicated by listing number, with capture time and price history

Nothing is sent anywhere by this tool. (Note that whatever Claude reads through the tools is, of course, processed by the Claude client you use.) Delete the directory to remove all data.

## Privacy (KVKK)

Seller name, phone number and profile links are **not parsed and not stored**. Only the seller type (owner / dealer / authorized dealer) is kept. Do not commit your inbox or store; both are in `.gitignore`.

## Known limitations

- Not fully automatic: you must open and save the pages yourself. This is the deliberate, legitimate way around the Cloudflare challenge.
- **URL filter parameters are partly unverified.** The sahibinden query parameters used to build search URLs (`price_min`/`price_max`, `a5_min`/`a5_max` for year, `a4_min`/`a4_max` for km, `sorting`, `pagingSize`) and the city handling are based on public knowledge and could not be checked against the live site. Transmission and fuel value IDs are unknown, so they are **not** added to URLs; the returned `note` asks you to pick them in sahibinden's filter panel. Filtering inside the local store is done by this tool and does not depend on these parameters. All URL constants live in `src/sahibinden/url-schema.ts` and are flagged `verified: false`.
- **The parser has so far been validated only against synthetic fixtures**, not real saved pages. It matches Turkish field labels rather than CSS classes, returns `null` for unknown fields and attaches `warnings[]`, but real pages may reveal gaps.
- Search rows rarely include transmission/fuel; those become known after importing the listing page.
- Safari `.webarchive` files are not supported. Use Chrome or Firefox ("Webpage, Complete" or "HTML only").
- If the saved file loses its URL, the parser tries `link[rel=canonical]`, `og:url`, Chrome's `saved from url` comment, a URL built from the listing number, and finally the `sourceUrl` argument.
- Version 0.1.0 is early software.

## Development

```bash
npm run build       # compile TypeScript to dist/
npm run typecheck
npm test            # vitest
npm run smoke       # end-to-end stdio check against dist/ with synthetic fixtures in a temp home
```

Parser and normalizer functions are pure (no I/O, no clock). Tests use only small, synthetic, anonymized fixtures; **never commit real listing HTML** (it contains third-party content and personal data). `tests/fixtures/private/` is git-ignored for local experiments.

## Roadmap

- Validate the URL scheme and parser against real saved pages
- `analyze_market_price` and `find_price_drops` (price history is already recorded in the store)
- Optional additional providers behind the existing `Provider` interface, only if sahibinden.com offers an official API or access policy changes

## License

[MIT](LICENSE) (c) 2026 Bilal Gökdağ. sahibinden.com is a trademark of its respective owner; this project is unaffiliated with it.
