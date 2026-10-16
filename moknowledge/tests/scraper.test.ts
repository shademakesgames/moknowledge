import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractInto, parsePage } from "../src/lib/scraper/extract";
import { discoverLinks, crawlWebsite, MAX_PAGES } from "../src/lib/scraper/crawl";
import { isPublicAddress, normalizeUrl, fetchPublicPage } from "../src/lib/scraper/fetch-page";
import { newKnowledge, knowledgeSchema, fieldText } from "../src/lib/knowledge";
const html = readFileSync(new URL("./fixtures/business.html", import.meta.url), "utf8");
const url = "https://cedar.example/";

test("extracts JSON-LD graph, prices, people, sources, and filters share links", () => {
  const record = newKnowledge(url); extractInto(record, parsePage(html, url), true);
  assert.equal(fieldText(record.sections.foundation.name), "Cedar Books LLC");
  assert.equal(fieldText(record.sections.foundation.yearFounded), "2003");
  assert.equal(fieldText(record.sections.foundation.employeeCount), "8");
  assert.equal(record.people[0].fields.gender.value, null);
  assert.match(fieldText(record.offerings[0].fields.pricing), /USD 50 per month/);
  assert.equal(record.sections.presence.facebook.value, null);
  assert.match(fieldText(record.sections.presence.instagram), /cedarbooks/);
  assert.ok(record.sections.foundation.name.sources.length);
  assert.ok(fieldText(record.sections.insights.faqs).includes("payroll"));
  assert.ok(knowledgeSchema.safeParse(record).success);
});
test("does not mistake copyright for founding or invent absent facts", () => {
  const record = newKnowledge(url); extractInto(record, parsePage("<title>Test</title><footer>Copyright 2026 Test</footer>", url), true);
  assert.equal(record.sections.foundation.yearFounded.value, null);
  assert.equal(record.sections.market.idealPersona.value, null);
});
test("discovery normalizes tracking links and avoids off-site and non-page URLs", () => {
  const links = discoverLinks(parsePage(html, url), new URL(url).origin).map(item => item.url);
  assert.ok(links.includes(`${url}services/payroll`));
  assert.ok(links.includes(`${url}about`));
  assert.ok(!links.some(link => /outside|pdf|login|utm_/.test(link)));
});
test("blocks non-public addresses, IPv4-mapped IPv6, bad schemes, and credentials", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fc00::1", "::ffff:127.0.0.1", "0.0.0.0", "224.0.0.1"]) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(normalizeUrl("cedar.example").href, url);
  for (const input of ["file:///etc/passwd", "https://user:pass@cedar.example", "https://cedar.example:8080"]) assert.throws(() => normalizeUrl(input));
});
test("transport rejects loopback before opening a connection", async () => {
  await assert.rejects(fetchPublicPage("http://127.0.0.1/", { signal: AbortSignal.timeout(1000) }), /not allowed/);
});
test("bounded crawl retains partial results and respects robots rules", async () => {
  const requested: string[] = [];
  const fetcher: typeof fetchPublicPage = async (input, options) => {
    await options.beforeRequest?.(new URL(input)); requested.push(input);
    if (input.endsWith("robots.txt")) return { url: input, status: 200, contentType: "text/plain", body: "User-agent: *\nDisallow: /services/payroll" };
    if (input.endsWith("contact")) throw new Error("Connection failed");
    return { url: input, status: 200, contentType: "text/html", body: html };
  };
  const record = await crawlWebsite(url, { fetcher, pauseMs: 0 });
  assert.ok(record.crawl.pages.some(page => page.status === "success"));
  assert.ok(record.crawl.pages.some(page => page.status === "failed"));
  assert.ok(record.crawl.pages.some(page => page.status === "skipped"));
  assert.ok(!requested.some(page => page.endsWith("services/payroll")));
  assert.ok(record.crawl.pages.length <= 8);
});
test("edited values and original evidence survive JSON round-trip; invalid imports fail", () => {
  const record = newKnowledge(url); extractInto(record, parsePage(html, url), true);
  const original = record.sections.foundation.name;
  record.sections.foundation.name = { ...original, originalValue: original.value, value: "Reviewed business", status: "user_provided", reviewed: true };
  const restored = knowledgeSchema.parse(JSON.parse(JSON.stringify(record)));
  assert.equal(restored.sections.foundation.name.value, "Reviewed business");
  assert.equal(restored.sections.foundation.name.originalValue, "Cedar Books LLC");
  assert.ok(restored.sections.foundation.name.sources.length);
  assert.equal(knowledgeSchema.safeParse({ ...record, schemaVersion: 2 }).success, false);
  assert.equal(knowledgeSchema.safeParse({ ...record, requestedUrl: "javascript:alert(1)" }).success, false);
});

test("ignores hidden platform dialogs and recognizes explicit biography evidence", () => {
  const pageUrl = "https://cedar.example/about-us/jamie-reed";
  const record = newKnowledge(pageUrl);
  const page = parsePage('<title>Jamie Reed — Founder</title><h1>Jamie Reed, CPA</h1><p>My experience includes accounting and, since 2003, my own accounting practice serving local businesses with care.</p><div class="jetstream-modal"><p>We help small businesses upload Your Stuff to our unrelated hosting service.</p></div>', pageUrl);
  extractInto(record, page, true);
  assert.equal(record.people[0].fields.name.value, "Jamie Reed");
  assert.equal(record.people[0].fields.gender.value, null);
  assert.equal(record.sections.foundation.yearFounded.value, "2003");
  assert.ok(!fieldText(record.sections.market.targetBuyers).includes("Your Stuff"));
});
test("structured service on a page prevents a duplicate heading-based offering", () => {
  const pageUrl = "https://cedar.example/services/payroll";
  const record = newKnowledge(pageUrl); extractInto(record, parsePage(html, pageUrl), true);
  assert.equal(record.offerings.length, 1);
});
test("crawl visits homepage links and the links found on them, but stops two steps out", async () => {
  const requested: string[] = [];
  const fetcher: typeof fetchPublicPage = async (input, options) => {
    await options.beforeRequest?.(new URL(input)); requested.push(input);
    if (input.endsWith("robots.txt")) return { url: input, status: 404, contentType: "text/plain", body: "" };
    if (input === url) return { url: input, status: 200, contentType: "text/html", body: '<h1>Business</h1>' + Array.from({ length: 20 }, (_, i) => `<a href="/services/item-${i}">Service ${i}</a>`).join("") };
    return { url: input, status: 200, contentType: "text/html", body: `<h1>Service page</h1><p>Readable service copy for this page that is long enough.</p><a href="${input}/deeper">Deeper</a>` };
  };
  const record = await crawlWebsite(url, { fetcher, pauseMs: 0 });
  assert.ok(record.crawl.pages.length <= MAX_PAGES);
  assert.ok(requested.some(page => page.endsWith("services/item-19")));
  assert.ok(requested.some(page => page.endsWith("/deeper")), "second-step pages should be crawled");
  assert.ok(!requested.some(page => page.endsWith("/deeper/deeper")), "third-step pages should not be crawled");
});
test("crawl stops at the page cap even when the homepage links to more pages", async () => {
  const fetcher: typeof fetchPublicPage = async (input, options) => {
    await options.beforeRequest?.(new URL(input));
    return { url: input, status: input.endsWith('robots.txt') ? 404 : 200, contentType: "text/html", body: '<h1>Business</h1>' + Array.from({ length: 60 }, (_, i) => `<a href="/services/item-${i}">Service ${i}</a>`).join('') };
  };
  const record = await crawlWebsite(url, { fetcher, pauseMs: 0 });
  assert.equal(record.crawl.pages.length, MAX_PAGES);
  assert.ok(record.crawl.warnings.some(warning => warning.includes('bounded crawl')));
});

test("logo prefers structured data and falls back to a header image as inferred", () => {
  const pageUrl = "https://cedar.example/";
  const structured = newKnowledge(pageUrl);
  extractInto(structured, parsePage('<title>Cedar Books</title><script type="application/ld+json">{"@type":"Organization","name":"Cedar Books LLC","logo":"https://cedar.example/logo.png"}</script>', pageUrl), true);
  assert.equal(fieldText(structured.sections.foundation.logo), "https://cedar.example/logo.png");
  const headerOnly = newKnowledge(pageUrl);
  extractInto(headerOnly, parsePage('<title>Cedar</title><header><img class="site-logo" alt="Cedar logo" src="/img/brand.svg"></header>', pageUrl), true);
  assert.equal(fieldText(headerOnly.sections.foundation.logo), "https://cedar.example/img/brand.svg");
  assert.equal(headerOnly.sections.foundation.logo.status, "inferred");
});
test("calls to action and contact details do not become needs or differentiators", () => {
  const pageUrl = "https://cedar.example/";
  const record = newKnowledge(pageUrl);
  extractInto(record, parsePage('<title>Cedar</title><main><p>Contact us today at (954) 592-8630 to learn how we can help you with taxes.</p><p>We specialize in payroll for small clinics across Oregon.</p></main>', pageUrl), true);
  assert.equal(fieldText(record.sections.market.customerNeeds), "");
  assert.equal(fieldText(record.sections.positioning.differentiators), "We specialize in payroll for small clinics across Oregon.");
});
test("records saved before logos and competitors existed still validate with defaults", () => {
  const legacy = JSON.parse(JSON.stringify(newKnowledge(url)));
  delete legacy.competitors; delete legacy.sections.foundation.logo;
  const parsed = knowledgeSchema.parse(legacy);
  assert.deepEqual(parsed.competitors, []);
  assert.equal(parsed.sections.foundation.logo.value, null);
});
test("legal section captures same-site policy links, licensing, and named compliance frameworks", () => {
  const pageUrl = "https://cedar.example/";
  const record = newKnowledge(pageUrl);
  extractInto(record, parsePage('<title>Cedar</title><footer><a href="https://cedar.example/privacy-policy">Privacy Policy</a><a href="https://cedar.example/terms-of-use">Terms</a><a href="https://calendly.com/privacy">Calendly privacy</a></footer><main><p>We are licensed by the state board of accountancy, license no. 12345, and we are HIPAA compliant.</p></main>', pageUrl), true);
  assert.equal(record.sections.legal.privacyPolicyUrl.value, "https://cedar.example/privacy-policy");
  assert.equal(record.sections.legal.termsUrl.value, "https://cedar.example/terms-of-use");
  assert.match(fieldText(record.sections.legal.licenses), /licensed by/);
  assert.deepEqual(record.sections.legal.compliance.value, ["HIPAA"]);
});
test("menu item cards keep their image, caption, price, and type", () => {
  const pageUrl = "https://cafe.example/menu";
  const record = newKnowledge(pageUrl);
  extractInto(record, parsePage('<title>Cafe menu</title><main><h1>Menu</h1><ul><li class="menu-item"><img src="/img/burger.jpg" alt="Classic burger"><h3>Classic burger</h3><p>Beef patty, cheddar.</p><span>$12.50</span></li></ul></main>', pageUrl), false);
  const burger = record.offerings.find(entry => fieldText(entry.fields.name) === "Classic burger");
  assert.ok(burger);
  assert.equal(fieldText(burger!.fields.type), "Menu item");
  assert.equal(fieldText(burger!.fields.images), "https://cafe.example/img/burger.jpg — Classic burger");
  assert.match(fieldText(burger!.fields.pricing), /\$12\.50/);
});
test("records saved before the legal section still validate", () => {
  const legacy = JSON.parse(JSON.stringify(newKnowledge(url)));
  delete legacy.sections.legal;
  assert.equal(knowledgeSchema.parse(legacy).sections.legal.termsUrl.value, null);
});
test("footer licensing, license numbers, and compliance badges are found even though the footer is not body copy", () => {
  const pageUrl = "https://cedar.example/";
  const record = newKnowledge(pageUrl);
  extractInto(record, parsePage('<title>Cedar</title><main><p>Accounting for local owners.</p></main><footer><p>Licensed CPA firm, License #CA-45821.</p><span>HIPAA compliant</span></footer>', pageUrl), true);
  assert.ok(fieldText(record.sections.legal.licenses).includes("License #CA-45821"));
  assert.deepEqual(record.sections.legal.compliance.value, ["HIPAA"]);
});
test("privacy pages supply data practices and the policy URL", () => {
  const pageUrl = "https://cedar.example/privacy-policy";
  const record = newKnowledge(pageUrl);
  extractInto(record, parsePage('<title>Privacy</title><main><p>We collect personal information such as your name and email address when you contact us.</p></main>', pageUrl), false);
  assert.equal(record.sections.legal.privacyPolicyUrl.value, pageUrl);
  assert.match(fieldText(record.sections.legal.dataPractices), /personal information/);
});
test("lazy-loaded menu images and page-level food notices reach each menu item", () => {
  const pageUrl = "https://cafe.example/menu";
  const record = newKnowledge(pageUrl);
  extractInto(record, parsePage('<title>Menu</title><main><h1>Menu</h1><div class="dish"><img data-src="/img/tacos.jpg" alt="Street tacos"><h4>Street tacos</h4><p>Three corn tortillas with onion and cilantro.</p></div><p>Consuming raw or undercooked meats may increase your risk of foodborne illness.</p></main>', pageUrl), false);
  const tacos = record.offerings.find(entry => fieldText(entry.fields.name) === "Street tacos");
  assert.ok(tacos);
  assert.equal(fieldText(tacos!.fields.images), "https://cafe.example/img/tacos.jpg — Street tacos");
  assert.match(fieldText(tacos!.fields.disclaimers), /Consuming raw/);
});
test("meta tags, canonical, language, headings, and main text are captured for each page", () => {
  const pageUrl = "https://cedar.example/";
  const page = parsePage('<html lang="en"><head><title>Cedar</title><meta name="keywords" content="payroll, bookkeeping"><meta property="og:title" content="Cedar Books"><link rel="canonical" href="https://cedar.example/"></head><body><nav>Menu links</nav><main><h1>Payroll for small teams</h1><p>We run payroll every two weeks for local employers.</p></main></body></html>', pageUrl);
  assert.equal(page.meta["og:title"], "Cedar Books");
  assert.equal(page.meta.lang, "en");
  assert.equal(page.meta.canonical, pageUrl);
  assert.deepEqual(page.headings, ["Payroll for small teams"]);
  assert.match(page.mainText, /every two weeks/);
  assert.ok(!page.mainText.includes("Menu links"));
});
test("script assets reveal platforms and tel or mailto links reveal contact details", () => {
  const pageUrl = "https://cedar.example/";
  const record = newKnowledge(pageUrl);
  extractInto(record, parsePage('<html><head><script src="https://cdn.shopify.com/s/files/theme.js"></script></head><body><a href="tel:+19545928630">Call</a><a href="mailto:hello@cedar.example">Email</a></body></html>', pageUrl), true);
  assert.ok(fieldText(record.sections.foundation.platforms).includes("Shopify"));
  assert.ok(fieldText(record.sections.foundation.phones).includes("954"));
  assert.match(fieldText(record.sections.foundation.emails), /hello@cedar\.example/);
});
test("embedded state and dataLayer objects yield products without executing scripts", () => {
  const pageUrl = "https://shop.example/";
  const record = newKnowledge(pageUrl);
  extractInto(record, parsePage('<html><body><script>window.__INITIAL_STATE__ = {"catalog":{"products":[{"name":"Starter plan","price":"29"}]}};</script><script>dataLayer.push({ecommerce: {items: [{item_name: "Blue mug", price: 12}]}});</script></body></html>', pageUrl), true);
  const names = record.offerings.map(entry => fieldText(entry.fields.name));
  assert.ok(names.includes("Starter plan"));
  assert.ok(names.includes("Blue mug"));
});

