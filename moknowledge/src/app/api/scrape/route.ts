import { z } from "zod";
import { crawlWebsite } from "@/lib/scraper/crawl";
import { createRenderer } from "@/lib/scraper/render";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;
const inputSchema = z.object({ url: z.string().trim().min(1).max(2048) });
let activeCrawls = 0;
// Each crawl fetches up to 40 pages from someone else's site, so one client gets a few crawls per window, one at a time.
const CRAWLS_PER_WINDOW = Number(process.env.SCRAPE_RATE_LIMIT) || 6;
const WINDOW_MS = Number(process.env.SCRAPE_RATE_WINDOW_MS) || 10 * 60_000;
const limiter = createRateLimiter({ limit: CRAWLS_PER_WINDOW, windowMs: WINDOW_MS });
const activeClients = new Set<string>();

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  let input: z.infer<typeof inputSchema>;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing request body");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 4096) { await reader.cancel(); throw new Error("Request too large"); } chunks.push(chunk.value); }
    input = inputSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch { return Response.json({ error: "Enter a website URL (up to 2,048 characters)." }, { status: 400 }); }
  const client = clientKey(request);
  if (activeClients.has(client)) return Response.json({ error: "Your previous crawl is still running. Wait for it to finish." }, { status: 429, headers: { "Retry-After": "10" } });
  if (activeCrawls >= 2) return Response.json({ error: "Two crawls are already running. Please try again shortly." }, { status: 429, headers: { "Retry-After": "10" } });
  // The window is checked last, so a request turned away for being busy does not use up one of the client's crawls.
  const verdict = limiter.take(client);
  if (!verdict.allowed) {
    const minutes = Math.ceil(verdict.retryAfterSeconds / 60);
    return Response.json({ error: `You have reached the crawl limit. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }, { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } });
  }
  activeCrawls++; activeClients.add(client);
  try {
    const knowledge = await crawlWebsite(input.url, { signal: request.signal, renderer: createRenderer() });
    return Response.json({ knowledge }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Website could not be analyzed." }, { status: 422 });
  } finally { activeCrawls--; activeClients.delete(client); }
}
