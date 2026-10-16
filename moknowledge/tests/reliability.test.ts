import test from "node:test";
import assert from "node:assert/strict";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { crawlWebsite } from "../src/lib/scraper/crawl";
import { decodeBody } from "../src/lib/scraper/fetch-page";

const HOME = `<html><head><title>Acme Plumbing</title></head><body><main><p>${"Acme Plumbing serves Reno homeowners with repairs and installs. ".repeat(10)}</p></main></body></html>`;
// Like the real fetcher, page requests run the crawler's robots check; the robots.txt request itself does not.
const site = (robotsStatus: number, home = HOME) => async (input: string, options: { beforeRequest?: (url: URL) => Promise<void> }) => {
  if (input.endsWith("/robots.txt")) return { url: input, status: robotsStatus, body: "", contentType: "text/plain" };
  await options.beforeRequest?.(new URL(input));
  return input === "https://acme.example/" ? { url: input, status: 200, body: home, contentType: "text/html" } : { url: input, status: 404, body: "", contentType: "text/html" };
};

test("a malformed tel: link does not fail the crawl", async () => {
  const home = HOME.replace("</main>", `<a href="tel:%E0%A4%A">Call</a><a href="tel:775-555-0142">775-555-0142</a></main>`);
  const record = await crawlWebsite("https://acme.example/", { fetcher: site(404, home) as never, pauseMs: 0 });
  assert.equal(record.crawl.pages[0].status, "success");
  assert.deepEqual(record.sections.foundation.phones.value, ["(775) 555-0142"]);
});

test("a 401 or 403 robots.txt means no rules apply", async () => {
  for (const status of [401, 403]) {
    const record = await crawlWebsite("https://acme.example/", { fetcher: site(status) as never, pauseMs: 0 });
    assert.equal(record.crawl.pages[0].status, "success", `robots.txt HTTP ${status}`);
  }
});

test("a 5xx robots.txt still stops the crawl", async () => {
  await assert.rejects(crawlWebsite("https://acme.example/", { fetcher: site(503) as never, pauseMs: 0 }), /robots\.txt \(HTTP 503\)/);
});

test("a headless render stops when the crawl is cancelled", { timeout: 5000 }, async () => {
  const thin = `<html><head><title>Acme</title></head><body><div id="app"></div></body></html>`;
  let sawSignal = false;
  // This renderer only finishes when it is told to stop, like a page that never settles.
  const renderer = {
    render: (_url: string, signal?: AbortSignal) => new Promise<string | null>(resolve => {
      sawSignal = Boolean(signal);
      signal?.addEventListener("abort", () => resolve(null), { once: true });
    }),
    close: async () => undefined,
  };
  const started = Date.now();
  const record = await crawlWebsite("https://acme.example/", { fetcher: site(404, thin) as never, pauseMs: 0, renderer, signal: AbortSignal.timeout(150) });
  assert.ok(sawSignal, "the crawl passes its signal to the renderer");
  assert.ok(Date.now() - started < 2000, "the crawl returns soon after cancellation");
  assert.ok(record.crawl.warnings.some(warning => /time limit/.test(warning)));
});

test("compressed responses are decoded", () => {
  const html = "<html><body><p>Compressed page</p></body></html>";
  assert.equal(decodeBody(gzipSync(html), "gzip", "text/html"), html);
  assert.equal(decodeBody(brotliCompressSync(html), "br", "text/html"), html);
  assert.equal(decodeBody(deflateSync(html), "deflate", "text/html"), html);
  assert.equal(decodeBody(Buffer.from(html), "", "text/html"), html);
  assert.throws(() => decodeBody(Buffer.from(html), "zstd", "text/html"), /unsupported compressed/);
});

test("a small compressed body cannot expand past the size limit", () => {
  assert.throws(() => decodeBody(gzipSync(Buffer.alloc(3_000_000)), "gzip", "text/html", 1_000_000), /download size limit/);
});

test("pages are decoded with their declared charset", () => {
  const latin1 = Buffer.from([0x43, 0x61, 0x66, 0xe9]); // "Café" in Windows-1252 / ISO-8859-1
  assert.equal(decodeBody(latin1, "", "text/html; charset=windows-1252"), "Café");
  const withMeta = Buffer.concat([Buffer.from('<meta charset="iso-8859-1"><p>'), latin1, Buffer.from("</p>")]);
  assert.equal(decodeBody(withMeta, "", "text/html"), '<meta charset="iso-8859-1"><p>Café</p>');
  assert.equal(decodeBody(Buffer.from("Café"), "", "text/html; charset=not-a-charset"), "Café");
});
