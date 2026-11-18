# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Verified sahibinden URL parameters (2026-11-18): transmission, fuel, seller type, body type, color, vehicle condition, engine power/volume, drivetrain, exchange, listing date, unpainted/unchanged-parts, 8 sort orders, `pagingOffset`, `price_currency`; documented in `docs/04-URL-SCHEMA.md`.
- 81-province plate-code table with Turkish folding; only Samsun (55) and Istanbul (34) are verified, others are flagged in the URL `note`.
- New zod-enum fields on `search_cars`; `cityHint` on `import_listing_html`; optional `neighborhood` and `locationRaw` on listing summaries.

### Changed
- City is now sent as `address_city={plate code}` instead of a path suffix; brand-only search uses `/{brand}`.
- Search parser reads the location cell by page context ("Province District" vs "District Neighborhood"); ambiguous cells are kept in `locationRaw` with a warning.

### Removed
- Unverified `pagingSize` parameter.

## [0.1.0] - 2026-11-18

First version. Not yet published.

### Added
- MCP server over stdio built on `@modelcontextprotocol/server` v2 with zod 4 schemas; logs go to stderr only.
- Inbox-based import flow: no network requests to sahibinden.com, no anti-bot bypass, no cookies or account needed.
- Tools: `ping`, `search_cars`, `get_listing`, `compare_cars`, `import_listing_html`.
- Label-based HTML parser (cheerio) for saved search and listing pages, with page type detection (search / listing / challenge / unknown), Turkish value normalizers and per-listing `warnings`.
- Challenge-page detection that reports half-loaded saved pages as skipped instead of importing them.
- Local JSON store with de-duplication by listing number, capture time and price history.
- Filtering and sorting in `search_cars` with `unknownFields` marking for listings that lack a filtered field.
- Sahibinden search URL builder returned by `search_cars`; low-confidence parameters (transmission/fuel IDs) are omitted with a note.
- `compare_cars` statistics: age, km per year, price difference versus set median, damage/paint/replaced part counts.
- Privacy: seller name, phone and profile are not parsed or stored; descriptions are truncated to 4000 characters and flagged as untrusted text.
- Environment variables `SAHIBINDEN_MCP_HOME` and `LOG_LEVEL`.
- Vitest suite with synthetic fixtures and a stdio end-to-end smoke script (`npm run smoke`).
- README, MIT license and this changelog.

### Known limitations
- URL filter parameters are partly unverified against the live site (`verified: false` in `src/sahibinden/url-schema.ts`).
- Parser validated only with synthetic fixtures so far.
- Safari `.webarchive` files are not supported.
