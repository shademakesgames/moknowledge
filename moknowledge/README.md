# MoKnowledge

A Next.js 15 application that builds an editable, source-backed company knowledge base from a public website. It crawls real HTML and uses deterministic extraction; it does not call an LLM or invent missing business facts.

## Run locally

Requires Node.js 22.19+ (validated with Node 24) and npm.

```bash
npm ci
npm run dev
```

Open http://localhost:3000/knowledge. `/` redirects there. Saved records live at `/knowledge/view`.

```bash
npm test
npm run typecheck
npm run build
npm start
```

The development server uses Turbopack; production uses the standard Next build. System fonts avoid external font downloads. No environment variables, API keys, or database are required.

## Features

- URL input accepts a hostname or HTTP/HTTPS URL, with validation and cancellable loading.
- Real crawler: fetches every same-origin link on the homepage (up to 40 pages in total, one hop deep; links found on those pages are not followed), prioritized, robots.txt, 40-second crawl budget, eight-second individual request budget, two-MB page limit, and four redirects.
- Company foundation (including a primary logo with preview), positioning, market/customers, branding, social presence, people, offerings, a manually maintained competitor list, plus content/trust signals.
- Editable scalar and list fields, add/remove people and offerings, source excerpts, review status, and original values retained after edits.
- Saved records in browser-local storage, cards/table/detail views, search, editing, deletion, schema-validated JSON import and export.
- Responsive desktop/mobile interface, labeled controls, keyboard focus, status messages, empty states, and error recovery.

## Architecture

```text
src/app/knowledge/page.tsx       Builder route
src/app/knowledge/view/page.tsx  Library route
src/app/api/scrape/route.ts      Validated HTTP endpoint
src/components/                 Builder, editor, library, application shell
src/context/KnowledgeProvider  Shared browser-local record state
src/lib/knowledge.ts            Runtime schema, field definitions, export helpers
src/lib/scraper/fetch-page.ts   DNS/address protection, redirects, request limits
src/lib/scraper/crawl.ts        Robots rules, discovery, crawl budget, partial results
src/lib/scraper/extract.ts      Pure HTML parsing and deterministic extraction
```

The browser posts a URL to `/api/scrape`. The server returns `{ knowledge }` or `{ error }`. Zod validates responses, stored data, imports, and exports. The UI never renders scraped HTML. Clicking Save persists the reviewed JSON and increments the local version. Download exports the current draft (and explicitly reports if it still has unsaved changes).

## Scraper coverage

The crawler reads the homepage and up to 40 pages. It finds pages in four ways: links on the homepage, links on those pages that point to people, offering, FAQ, or policy pages (two hops, no further), sitemap.xml (from robots.txt and /sitemap.xml), and platform shortcuts. Shopify sites are read through /products.json, WordPress through /wp-json/wp/v2/pages and WooCommerce products, and Squarespace through ?format=json. When a page has almost no text, the crawler renders it in headless Chromium to read JavaScript-built content (up to 6 renders per crawl). Renders stop when the crawl is cancelled or times out.

To use the headless fallback, install a Chromium build and set `CHROMIUM_PATH` to its executable, for example `CHROMIUM_PATH=/usr/bin/chromium`. Without it, the crawler works normally and skips rendering. Chromium runs with its sandbox on. Every request a rendered page makes is answered by the crawler's own pinned fetcher, so it gets the same public-address checks and Chromium never connects to the network itself; anything that escapes request routing goes to a closed proxy port. Non-GET requests, images, media, fonts, and stylesheets are blocked. A container that runs Chromium as root without user namespaces cannot start the sandbox: set `CHROMIUM_NO_SANDBOX=1` there, and only where the container cannot reach private networks. Run `CHROMIUM_PATH=… npm test` to include the real-browser checks (`RENDER_TEST_URL` picks the public page they render).

## Extraction and data quality

Structured Organization/LocalBusiness, Person, Service/Product/Offer, Question, and Review JSON-LD is preferred. Fallbacks use metadata, explicit founding statements, biography headings, service detail pages, address elements, social-profile links, CTAs, attributed quotes, and inline CSS. Malformed JSON-LD does not invalidate the entire page. Hidden dialogs, navigation, and other boilerplate are removed from business prose. Copyright years are not founding years; tracking vendors are not treated as business partners; gender is never inferred from names or photos.

Every field stores `value`, `status`, `sources`, and `reviewed`. Status is `extracted`, `inferred`, `user_provided`, or `unknown`. Source entries contain URL, excerpt, extraction locator, and retrieval timestamp. Editing retains the original value and labels citations as supporting the original extraction. Narrative claims (needs, differentiators, certifications, disclaimers) are split into sentences, and calls to action or contact details are dropped so they cannot masquerade as business facts. Brand colors are ranked ahead of neutral greys. Lists have field-level evidence; attribution of each individual list item is a future improvement. Competitors are rarely published on company sites, so that list is entered by a reviewer. Alternate source evidence is retained for review, but conflict resolution is not fully automated.

The schema supports every baseline category, but support does not guarantee a populated value. Employee counts, industry outlook, personas, writing/art style, pitch, and business model often remain unknown unless explicitly extracted or supplied by a reviewer. Industry and offering/topic classifications are marked inferred. Brand colors/fonts from inline CSS are candidates, not confirmed brand guidelines. First-party testimonials and credentials are not independently verified.

## Real example

`examples/account-it.json` is generated from a real crawl of https://account-it.net/ with the same pipeline used by the API. It is not copied from the assignment profile. Unknown fields remain null. Import it in the library to inspect it, or regenerate:

```bash
npm run scrape:example
# Optional different public website and output path:
npm run scrape:example -- https://www.iana.org/ examples/iana.json
```

The script does not save directly into browser storage. Network access and current robots rules affect regeneration.

## Database and AI thinking

See `docs/database.md` and `docs/database.sql` for a proposed multi-tenant Supabase schema, ownership relationships, append-only versions, and RLS policies. This design is documented, not deployed. The demo retains only the latest version per browser-local record.

`prompts/` contains three grounding-aware enrichment prompts for fact extraction, pitches, and downstream content planning. These are documentation, not live integrations. Future enrichment could use owner questionnaires, approved brand guidelines, authorized analytics/CRM data, and verified business listings. Keep source permissions, recency, conflicts, and human review explicit.

## Limits and deployment notes

- Public HTML, with headless rendering only for thin pages when Chromium is configured. No CAPTCHA bypass, login, linked stylesheet fetching, or visual analysis. Gzip, deflate, and Brotli responses are decompressed within the same size limit, and pages are decoded with the charset from the Content-Type header or a `<meta>` tag.
- Crawl breadth is intentionally limited; service catalogs may be incomplete. Heuristics can misclassify content and require review.
- Following RFC 9309, a 4xx robots.txt (including 401 and 403) means no rules; a 5xx or unreachable robots.txt stops that origin's crawl. Long crawl-delay requirements are skipped when they cannot fit the interactive budget.
- DNS addresses are validated with ipaddr.js and pinned to the connection; all redirect destinations are checked. Private, loopback, link-local, multicast, and reserved IPs are denied. Only HTTP/HTTPS with standard ports and no embedded credentials are accepted.
- Each client gets 6 crawls per 10 minutes (`SCRAPE_RATE_LIMIT`, `SCRAPE_RATE_WINDOW_MS`) and one crawl at a time; each server process runs at most two crawls. Clients are identified by the first `X-Forwarded-For` address, so run behind a proxy that sets it (Vercel and most load balancers do); without one, a client can change the header to look new. The counts live in each server process, so a multi-instance deployment needs a shared store such as Redis for the limit to hold. Add authentication, durable jobs, and infrastructure egress controls before public multi-user deployment.
- Storage is local to this browser, with no account synchronization or cross-tab conflict resolution. Export JSON for a durable portable copy. Corrupted storage is not automatically overwritten.
- PostCSS is overridden to compatible version 8.5.30 to address inherited runtime advisories while retaining Next.js 15. The production-only audit passes. Five development-tool advisories remain in the ESLint glob dependency chain; review compatible upstream fixes before deployment rather than force-changing the required framework major.

## Verification and screenshots

Unit tests cover JSON-LD, malformed blocks, missing data, provenance round-trips, social-link filtering, discovery, public-address restrictions, and robots/partial-crawl behavior. Browser QA is in `scripts/verify-browser.cjs`; it requires an available Playwright installation and Chromium (or `BROWSER_CHANNEL=chrome` for installed Chrome), with a production server on port 3001. Set `APP_URL` to override its `/knowledge` URL.

Screenshots from the running app:

- `docs/screenshots/builder.png`
- `docs/screenshots/review.png`
- `docs/screenshots/library.png`
- `docs/screenshots/builder-mobile.png`
- `docs/screenshots/library-mobile.png`

See `answers.txt` for the five required assignment responses.
