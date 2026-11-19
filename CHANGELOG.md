# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-11-19

### Added
- **Site-sourced vehicle catalog** (`src/sahibinden/catalog.json`, `catalog.ts`): category -> brand -> series/model -> engine paths read from sahibinden's own category tree (`#searchCategoryContainer`: `cl2` brand, `cl3` series, `cl4` engine) instead of guessing slugs. 96 car brands (78 with their full series lists, 566 series), 72 SUV and 41 minivan/panelvan brands. `search_cars` now resolves `brand` + `models` ("C200d", "320d", "3 Serisi 320d xDrive", "X5", "Astra 1.3 CDTI", "Egea") to the verified path, falls back to the series/brand page with a note when only part of the text matches, and lists the real series when a model is unknown. A model that exists in several categories/paths returns one URL per path.
- **Per-category filter profiles** (`CATEGORY_PROFILES`): otomobil, SUV (`arazi-suv-pickup`) and minivan/panelvan each use their own parameter names and value IDs (read live from the category sidebars). SUV now also supports body type (`a107181`), engine power (`a2321`), engine volume (`a2319`), warranty (`a87472`), AWD (mapped to 4x4); minivan supports year/km (`a767`/`a766`), transmission `a3807`, fuel `a1847`, seller `a769`, colour `a2045`, drivetrain `a107201`, body `a96780`, power `a4391`, volume `a4390`, heavy damage `a116447`. Merged ranges and filters a category does not have are reported in `note` rather than silently dropped.
- New body types: `crossover`, `pickup`, `suv` (SUV) and `glass-van`, `half-glass-van`, `panel-van`, `refrigerated-panel-van`, `minibus` (minivan).
- **Catalog learning**: every search page you import (or browser mode reads) also teaches the catalog its sidebar engine/series paths (`~/.sahibinden-car-mcp/catalog-learned.json`), with no extra requests.
- `scripts/build-catalog.mjs` + `scripts/catalog-data/` regenerate `catalog.json`; `docs/10-CATALOG.md` documents provenance and gaps.

### Fixed
- The "2 Aşamalı Doğrulama" gate page that sahibinden serves after a burst of automated requests is now recognised as a challenge (`detectPageType` and the CDP quick check), so browser mode stops instead of treating it as an unknown page.
- Local brand filter alias `VW` = Volkswagen (and `Chevy`).

### Known gaps
- Series lists are not yet scraped for 18 car brands (Seat, Skoda, Smart, Subaru, Suzuki, Tata, Tesla, The London Taxi, Tofaş, TOGG, Toyota, Vanderhall, Volkswagen, Volta, Volvo, XEV, Yuki, Zlin Motors) nor for SUV/minivan brands (except BMW SUV and Land Rover). For those the path follows the verified naming rule (`{brand}-{slug(model)}`), is marked unverified in `note`, and becomes verified once a page of that brand is imported. Engine lists are only known for a few series until pages are imported.

## [0.2.1] - 2026-11-19

### Fixed
- **SUV category.** SUVs (e.g. Land Rover Discovery) live under `/arazi-suv-pickup-{brand}-{model}`, and that category uses different filter IDs than `/otomobil`: year `a277`, km `a276`, transmission `a279` (33625 automatic), fuel `a287` (400 diesel), seller `a448`, colour `a275`, condition `a113988`, 4x4 `a95938`, heavy damage `a116446`. The otomobil IDs (`a5`, `a4`, `a6`, `a17`) are silently ignored there (488 unfiltered results). Land Rover (Discovery, Discovery Sport, Defender, Range Rover, Evoque, Sport, Velar, Freelander; `Range Rover` also accepted as a brand) now builds the SUV path with SUV IDs; filters not verified for SUV (body type, engine power/volume, warranty, AWD) are left out of the URL with a note. Verified live: `...land-rover-discovery?a277_min=2015&a277_max=2015&a276_max=200000&a287=400&a279=33625` returned 4 matching 2015 diesel automatic listings. Other SUV brands (BMW X, Mercedes GLC, etc.) are not mapped yet.

## [Unreleased]

### Added
- Claude Code plugin packaging: `.claude-plugin/` (plugin + marketplace), `.mcp.json`, single-file server `bundle/server.mjs` (`npm run bundle`, esbuild) and the `sahibinden-car` skill under `skills/`; installs without `npm install`/build (Node 22.12+).

### Fixed
- Mercedes search paths verified live (2026-11-19): `Mercedes`/`Benz` -> `/mercedes-benz`, `C 200 d` / `C200d` -> `/mercedes-benz-c-serisi-c-200-d` (A/B/C/E/S/R series). The local store filter now treats brand aliases (`Mercedes` = `Mercedes-Benz`) and spacing (`C200d` = `C 200 d`) as equal. Other brands still use the derived `/{brand}-{model}` path (unverified).

### Changed
- All 81 province plate codes (`CITIES`) are now verified against the official plate list and locked by `tests/cities.test.ts`; the "unverified city code" note is no longer added to search URLs. Live site acceptance of `address_city` was tried for 55 and 34 only.

## [0.2.0] - 2026-11-18

Default behaviour is unchanged: without `SAHIBINDEN_BROWSER_MODE=on` the server registers the same 5 tools as 0.1.2 and makes no network requests.

### Added
- Opt-in **browser mode** (`SAHIBINDEN_BROWSER_MODE=on`, off by default): drives a visible Chrome window that the user starts with `npm run chrome` (dedicated profile, no logins recommended) over the local DevTools port, and feeds the pages through the existing parser/store.
- Tools `browser_status` (never navigates), `live_search` (same filters as `search_cars` plus `maxPages`, default 3, hard maximum 10) and `live_get_listings` (default 3, maximum 10), registered only when the mode is on (8 tools instead of 5).
- Allow-listed, dependency-free CDP client over Node's built-in `WebSocket` (loopback only); no new dependencies.
- Fixed, cross-process limits: at least 5 s between pages, 3 (max 10) pages per call, 30 (max 60) pages per hour, 60 s cool-down after a verification page, one call at a time, 180 s per call.
- Stop-on-challenge: a Cloudflare verification page ends the call, keeps the tab open for the user to pass it, and blocks further navigation (`challenge-pending`) until it is cleared; no retries, no hiding, no solving.
- Structured status values (`ok`, `partial`, `disabled`, `unsupported-runtime`, `not-running`, `challenge-detected`, `challenge-pending`, `login-required`, `unexpected-page`, `timeout`, `navigation-error`, `deadline`, `hourly-cap`, `busy`) with Turkish `message`/`userAction`.
- Audit log `browser-log.jsonl` (URL, page type, HTTP status, counts; never HTML).
- Turkish Cloudflare challenge page detection ("Bir dakika lütfen...") in `detectPageType`, which also hardens the import flow.
- README "Browser mode (opt-in)" section with terms-of-use/account-risk warning, setup, limits, security note about the local debugging port, and configuration variables (`SAHIBINDEN_BROWSER_*`, `SAHIBINDEN_CHROME_PATH`).
- Smoke test now covers browser mode off (5 tools), on without Chrome (8 tools, `not-running`) and a fake-page-source `live_search`/`live_get_listings` flow.

### Changed
- `engines.node` is now `>=22.12` (Node 20 is end-of-life; browser mode needs the built-in `WebSocket`).
- `ping` output has an additional `browserMode` field (`disabled` / `enabled`).

## [0.1.2] - 2026-11-18

### Fixed
- Tramer extraction from the listing description no longer returns `null` when the amount sits before the keyword ("... 170.000 TL ... tramer") or when several dated records are listed; amounts are now found within 80 characters of the word "tramer" (TL, ₺, "bin", thousands dots).
- Amounts without a nearby "tramer" keyword (price, "12 TAKSİT") and price/instalment/trade-in amounts are never counted as tramer.

### Added
- Listing fields `tramerRecords` (`{date?, amount?, note?}`), `tramerStatus` (`none | amount | mentioned | unknown`); `tramerAmount` is now the sum of the record amounts. "tramer yok / kaydı yok / tramersiz" is reported as `none`. Description-derived values keep the warning "açıklamadan çıkarıldı, satıcı beyanı, doğrulanmadı".
- Re-import after an upgrade: duplicate detection is now content hash + `PARSER_VERSION` (2). A file whose stored record has an older (or no) parser version is re-parsed and the listing updated in place (price history kept); `duplicate` only when hash and version match. Optional `force: boolean` on `import_listing_html` re-parses regardless.
- `compare_cars` rows now include `tramerStatus` and `notes[]`; a full listing with an unknown or amount-less tramer gets "tramer tutarı açıklamada belirsiz; resmi tramer sorgusu yapın". Comparison statistics are unchanged.

## [0.1.1] - 2026-11-18

### Fixed
- `search_cars` price filter now respects currency: `priceMin`/`priceMax` apply in `priceCurrency` (default TL) and listings in another currency are excluded instead of slipping through as "unknown" (no conversion).
- The new filters (color, body type, seller type, vehicle condition, engine power, engine volume, drivetrain, trade-in, listed within, unpainted, no replaced parts, price currency) no longer only shape the URL; they now filter the local store too. Detail fields are read from the full listing record when it exists.
- Truncated URL ID lists completed from the live site: six missing colors (yellow, black, champagne, turquoise, orange, green), engine power ranges 226-250 up to 601+ hp (open-ended), engine volume 2501-3000 up to 5501-6000 and 6001+ cc (open-ended).

### Added
- `noHeavyDamage` (URL `a116445=1263354`) and `warranty` (URL `a4054`) filters, verified on the live site, applied locally and in the URL.
- `unknown: 'include' | 'exclude'` policy (`includeUnknown: false` still works as an alias).
- `search_cars` output: `appliedFilters`, `urlOnlyFilters` (empty), `excludedOtherCurrency`, `excludedUnknown`.
- Numeric engine power/volume ranges derived from the URL ID labels; `listedWithin` day check with an injectable clock.
- `docs/05-FILTER-AUDIT.md` (per-filter local/URL audit); tests for every filter, currency, unknown policy and combined filters; combined-filter smoke check.
- README demo no longer needs the year-range workaround (the EUR listing is now excluded by the price filter).

### Removed
- Known limitation "new filters only shape the URL".

## [0.1.0] - 2026-11-18

First public release.

### Features
- MCP server over stdio built on `@modelcontextprotocol/server` v2 with zod 4 schemas; logs go to stderr only.
- Inbox-based import flow: no network requests to sahibinden.com, no anti-bot bypass, no cookies or account needed. You save a page from your own browser (Cmd+S) and the server imports it.
- Tools: `ping`, `search_cars`, `get_listing`, `compare_cars`, `import_listing_html`.
- Label-based HTML parser (cheerio) for saved search and listing pages, with page type detection (search / listing / challenge / unknown), Turkish value normalizers and per-listing `warnings`. Checked against real saved search and detail pages (2026-11-18).
- Listing detail: price, year, km, fuel, transmission, engine, body type, drivetrain, seller type, trade-in, per-part paint/replaced map, description and location (province / district / neighborhood from the address breadcrumb).
- Challenge-page detection that reports half-loaded saved pages as skipped instead of importing them.
- Local JSON store with de-duplication by listing number, capture time and price history.
- Filtering and sorting in `search_cars` with `unknownFields` marking for listings that lack a filtered field.
- Sahibinden search URL builder with URL parameters verified on 2026-11-18 (year, km, price, transmission, fuel, seller type, body type, color, condition, power, volume, drivetrain, trade-in, date, unpainted / unchanged-parts, 8 sort orders, paging); see `docs/04-URL-SCHEMA.md`. City is sent as `address_city={plate code}` with a 81-province table (only Samsun 55 and Istanbul 34 are verified live; others are flagged in the URL `note`).
- Search page location is read by page context ("Province District" vs "District Neighborhood" when a city filter is active).
- `compare_cars` statistics: age, km per year, price difference versus set median, damage/paint/replaced part counts.
- Privacy: seller name, phone and profile are not parsed or stored; descriptions are truncated to 4000 characters and flagged as untrusted text.
- Environment variables `SAHIBINDEN_MCP_HOME` and `LOG_LEVEL`.
- Vitest suite with synthetic fixtures and a stdio end-to-end smoke script (`npm run smoke`).
- README, MIT license and this changelog.

### Known limitations
- Plate codes other than 55 and 34 are not verified against the live site.
- Search pages give no brand/series (only the model/trim cell); detail pages do.
- New `search_cars` filters (color, body type, ...) only shape the sahibinden URL; the local store filter does not apply them.
- Safari `.webarchive` files are not supported.
