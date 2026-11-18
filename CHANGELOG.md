# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-11-18

### Fixed
- `search_cars` price filter now respects currency: `priceMin`/`priceMax` apply in `priceCurrency` (default TL) and listings in another currency are excluded instead of slipping through as "unknown" (no conversion).
- The new filters (color, body type, seller type, vehicle condition, engine power, engine volume, drivetrain, trade-in, listed within, unpainted, no replaced parts, price currency) no longer only shape the URL; they now filter the local store too. Detail fields are read from the full listing record when it exists.

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
