import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { clientKey, createRateLimiter } from "../src/lib/rate-limit";
import { createRenderer, launchArgs, utf8ContentType } from "../src/lib/scraper/render";

test("the rate limiter allows a window's worth of requests, then reports when to retry", () => {
  let clock = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => clock });
  assert.equal(limiter.take("a").allowed, true);
  clock = 10_000; assert.equal(limiter.take("a").allowed, true);
  clock = 20_000;
  assert.deepEqual(limiter.take("a"), { allowed: false, retryAfterSeconds: 40 });
  assert.equal(limiter.take("b").allowed, true, "other clients are counted separately");
  clock = 60_001; assert.equal(limiter.take("a").allowed, true, "the oldest request has left the window");
});

test("the client key is the first forwarded address", () => {
  const request = (headers: Record<string, string>) => new Request("https://app.example/api/scrape", { headers });
  assert.equal(clientKey(request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  assert.equal(clientKey(request({ "x-real-ip": "198.51.100.4" })), "198.51.100.4");
  assert.equal(clientKey(request({})), "unknown");
});

test("the scrape route turns a client away after its crawls for the window", async () => {
  const { POST } = await import("../src/app/api/scrape/route");
  // A private address fails fast, before any page is fetched, so each request still counts as one crawl.
  const crawl = (client: string) => POST(new Request("https://app.example/api/scrape", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": client }, body: JSON.stringify({ url: "http://127.0.0.1/" }) }));
  for (let attempt = 0; attempt < 6; attempt++) assert.equal((await crawl("203.0.113.9")).status, 422);
  const limited = await crawl("203.0.113.9");
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.match((await limited.json()).error, /crawl limit/);
  assert.equal((await crawl("203.0.113.10")).status, 422, "another client is unaffected");
});

test("Chromium's sandbox is on unless a container opts out", () => {
  assert.ok(!launchArgs({}).includes("--no-sandbox"));
  assert.ok(launchArgs({ CHROMIUM_NO_SANDBOX: "1" }).includes("--no-sandbox"));
});

test("re-encoded text responses declare UTF-8", () => {
  assert.equal(utf8ContentType("text/html; charset=windows-1252"), "text/html; charset=utf-8");
  assert.equal(utf8ContentType("application/javascript"), "application/javascript; charset=utf-8");
  assert.equal(utf8ContentType("image/png"), "image/png");
});

// These need a real browser: CHROMIUM_PATH=/path/to/chrome npm test
const browser = { skip: !process.env.CHROMIUM_PATH && "set CHROMIUM_PATH to run real-browser checks", timeout: 60_000 };

test("the renderer cannot reach a local server, and Chromium never connects to it", browser, async () => {
  let hits = 0;
  const server = createServer((_request, response) => { hits++; response.end("<p>private</p>"); }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const renderer = createRenderer();
  try {
    const { port } = server.address() as AddressInfo;
    assert.equal(await renderer.render(`http://127.0.0.1:${port}/`), null);
    assert.equal(await renderer.render("http://localhost/"), null);
    assert.equal(hits, 0);
  } finally { await renderer.close(); server.close(); }
});

// RENDER_TEST_URL picks the public page, for networks where example.com does not resolve.
test("the renderer still reads a public page", browser, async () => {
  const renderer = createRenderer();
  try {
    const html = await renderer.render(process.env.RENDER_TEST_URL || "https://example.com/") ?? "";
    assert.ok(html.length > 500 && /<body/i.test(html), "a rendered document comes back");
  } finally { await renderer.close(); }
});
