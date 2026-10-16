import test from "node:test";
import assert from "node:assert/strict";
import { shopifyProducts, wordpressPages, sitemapLocs, safeUrl, squarespacePages } from "../src/lib/scraper/platforms";
import { crawlWebsite } from "../src/lib/scraper/crawl";
import { newKnowledge } from "../src/lib/knowledge";

const origin = "https://shop.example";

test("parses Shopify products.json", () => {
  const body = JSON.stringify({ products: [{ title: "Candle", handle: "candle", body_html: "<p>Soy candle</p>", variants: [{ price: "18.00" }], images: [{ src: "https://cdn.example/c.jpg" }] }] });
  const products = shopifyProducts(body);
  assert.equal(products.length, 1);
  assert.equal(products[0].title, "Candle");
});

test("parses WordPress pages with rendered content", () => {
  const body = JSON.stringify([{ link: "https://blog.example/about/", content: { rendered: "<p>About us</p>" } }]);
  const pages = wordpressPages(body, "https://blog.example");
  assert.equal(pages.length, 1);
  assert.match(pages[0].html, /About us/);
});

test("reads sitemap locations", () => {
  const xml = `<?xml version="1.0"?><urlset><url><loc>https://shop.example/a</loc></url><url><loc>https://shop.example/b</loc></url></urlset>`;
  assert.deepEqual(sitemapLocs(xml), ["https://shop.example/a", "https://shop.example/b"]);
});

test("safeUrl rejects non-http schemes", () => {
  assert.equal(safeUrl("javascript:alert(1)", origin), "");
});

test("squarespace helper tolerates empty input", () => {
  assert.deepEqual(squarespacePages("", origin), []);
});

test("crawl uses a renderer for thin pages", async () => {
  const thin = `<html><head><title>App</title></head><body><div id="root"></div></body></html>`;
  const full = `<html><head><title>Menu</title></head><body><main>${"Fresh coffee and pastries served daily. ".repeat(20)}</main></body></html>`;
  let rendered = 0;
  const renderer = { render: async () => { rendered++; return full; }, close: async () => {} };
  const fetcher = async (input: string) => {
    const u = new URL(input);
    if (u.pathname === "/robots.txt") return { url: input, status: 404, body: "", contentType: "text/plain" };
    if (u.pathname === "/") return { url: input, status: 200, body: thin, contentType: "text/html" };
    return { url: input, status: 404, body: "", contentType: "text/html" };
  };
  const result: any = await crawlWebsite("https://shop.example/", { fetcher: fetcher as any, renderer, pauseMs: 0 });
  assert.ok(rendered >= 1, "renderer should run on the thin homepage");
  assert.ok(result);
});

test("people and firm pages outrank blog posts in the crawl queue", async () => {
  const { rankUrl } = await import("../src/lib/scraper/crawl");
  const firm = rankUrl(new URL("https://account-it.net/firm-background"), "About");
  const bio = rankUrl(new URL("https://account-it.net/about-us/doug-cohen"), "Doug Cohen");
  const blog = rankUrl(new URL("https://account-it.net/blog/tax-deductions-for-realtors"), "Tax deductions for realtors");
  assert.ok(firm !== null && firm >= 100);
  assert.ok(bio !== null && bio >= 100);
  assert.ok(blog !== null && blog < 20);
});
