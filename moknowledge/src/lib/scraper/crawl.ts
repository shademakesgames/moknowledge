import robotsParser from "robots-parser";
import { knowledgeSchema, newKnowledge } from "../knowledge";
import { fetchPublicPage, normalizeUrl, USER_AGENT } from "./fetch-page";
import { finalizeKnowledge } from "./extract";
import { extractInto, parsePage, type ParsedPage } from "./extract";
import { applyShopifyProducts, applyWooProducts, shopifyProducts, sitemapLocs, squarespacePages, wooProducts, wordpressPages } from "./platforms";
import type { Renderer } from "./render";

export const MAX_PAGES = 40;
const MAX_RENDERS = 6;
type Robots = { isAllowed: (url: string, agent?: string) => boolean | undefined; getCrawlDelay: (agent: string) => number | undefined; getSitemaps?: () => string[] };
type QueueItem = { url: string; priority: number; depth: number; html?: string; note?: string };

// Ranks a URL by how useful it is for knowledge extraction. Null means the URL should never be fetched.
export function rankUrl(url: URL, text: string): number | null {
  if (/\.(?:pdf|png|jpe?g|gif|svg|webp|zip|mp4|mp3|xml|css|js|ico)$/i.test(url.pathname) || /\/(?:login|logout|signin|register|cart|checkout|account|search|tag|wp-admin|feed|calendar)(?:\/|$)/i.test(url.pathname)) return null;
  if (/add-to-cart|logout|replytocom/i.test(url.search)) return null;
  const hint = `${url.pathname} ${text}`.toLowerCase();
  // People and firm pages come first: they are the only source for team members, and blog archives can crowd them out.
  // Blog posts about taxes match service keywords, so the blog check runs first. They rank last so they cannot fill the page budget.
  if (/\/(?:blog|insights?|news)(?:\/|$)/.test(url.pathname) && !/about|team|founder|owner|staff|bio/.test(hint)) return 10;
  return /about|team|contact|company|founder|owner|leader|staff|people|bio|firm|who-we-are|meet|professional/.test(hint) ? 100 : /service|product|solution|pricing|tax|accounting|payroll|quickbooks|menu|shop|catalog|collection|gallery|special/.test(hint) ? 80 : /faq|testimonial|review/.test(hint) ? 60 : /privacy|terms|conditions|legal|disclaimer|licens|compliance|accessib/.test(hint) ? 85 : 20;
}
// Every same-origin link on the homepage is queued, ranked so the most useful pages are fetched first.
// Links on those pages are queued one more step out (bios under /about-us/team/…), and no further, which keeps the crawl bounded.
export function discoverLinks(page: ParsedPage, origin: string) {
  const ranked = new Map<string, number>();
  for (const link of page.links) {
    try {
      const url = normalizeUrl(link.url);
      if (url.origin !== origin) continue;
      for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
      const priority = rankUrl(url, link.text);
      if (priority !== null) ranked.set(url.href, Math.max(priority, ranked.get(url.href) ?? 0));
    } catch { /* Ignore unsupported links. */ }
  }
  return [...ranked].sort((a, b) => b[1] - a[1]).map(([url, priority]) => ({ url, priority }));
}

export async function crawlWebsite(input: string, options: { signal?: AbortSignal; fetcher?: typeof fetchPublicPage; pauseMs?: number; renderer?: Renderer } = {}) {
  const root = normalizeUrl(input);
  const knowledge = newKnowledge(root.href);
  const signal = AbortSignal.any([AbortSignal.timeout(40000), ...(options.signal ? [options.signal] : [])]);
  const fetcher = options.fetcher ?? fetchPublicPage;
  const robots = new Map<string, Robots>(); const lastRequest = new Map<string, number>();
  const beforeRequest = async (url: URL) => {
    if (!robots.has(url.origin)) {
      if (robots.size >= 5) throw new Error("Too many redirect origins.");
      const robotsUrl = `${url.origin}/robots.txt`;
      const response = await fetcher(robotsUrl, { signal, maxBytes: 200000 });
      // RFC 9309: a 4xx robots.txt (401, 403, 404, ...) means no rules apply; a 5xx means the site's rules are unknown, so crawling stops.
      if (response.status >= 500 || response.status < 200) throw new Error(`Could not verify robots.txt (HTTP ${response.status}).`);
      robots.set(url.origin, robotsParser(robotsUrl, response.status === 200 ? response.body : "") as Robots);
    }
    const rule = robots.get(url.origin)!;
    if (rule.isAllowed(url.href, USER_AGENT) === false) throw new Error("This page is disallowed by robots.txt.");
    const wait = Math.max(options.pauseMs ?? 300, (rule.getCrawlDelay(USER_AGENT) ?? 0) * 1000) - (Date.now() - (lastRequest.get(url.origin) ?? 0));
    if (wait > 5000) throw new Error("The site's crawl delay exceeds this short interactive crawl's budget.");
    if (wait > 0) await new Promise<void>((resolve, reject) => {
      signal.throwIfAborted();
      const abort = () => { clearTimeout(timer); reject(new Error("Crawl cancelled or timed out.")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, wait);
      signal.addEventListener("abort", abort, { once: true });
    });
    lastRequest.set(url.origin, Date.now());
  };
  const queue: QueueItem[] = [{ url: root.href, priority: 200, depth: 0 }];
  const seen = new Set<string>(); let origin = root.origin; let renders = 0;
  const enqueue = (url: string, priority: number, note?: string, html?: string, depth = 1) => {
    if (!seen.has(url) && !queue.some(queued => queued.url === url) && queue.length < 200) queue.push({ url, priority, depth, note, html });
  };
  // Side requests (platform data, sitemaps) follow the same robots rules and never leave the site.
  const fetchText = async (target: string): Promise<string | null> => {
    try {
      const response = await fetcher(target, { signal, maxBytes: 1500000, beforeRequest: async next => {
        if (next.origin !== origin) throw new Error("Skipped an off-site redirect.");
        await beforeRequest(next);
      } });
      return response.status === 200 ? response.body : null;
    } catch { return null; }
  };
  const loadSitemaps = async () => {
    const candidates = [...new Set([...(robots.get(origin)?.getSitemaps?.() ?? []), `${origin}/sitemap.xml`])].slice(0, 3);
    const locs: string[] = []; let childFetches = 0;
    for (const candidate of candidates) {
      const text = await fetchText(candidate); if (!text) continue;
      for (const loc of sitemapLocs(text)) {
        if (!/\.xml(?:\.gz)?$/i.test(loc)) { locs.push(loc); continue; }
        if (childFetches++ < 3) { const child = await fetchText(loc); if (child) locs.push(...sitemapLocs(child)); }
      }
    }
    for (const loc of locs.slice(0, 500)) {
      try {
        const url = normalizeUrl(loc); if (url.origin !== origin) continue;
        const priority = rankUrl(url, ""); if (priority !== null) enqueue(url.href, priority);
      } catch { /* Skip malformed sitemap entries. */ }
    }
  };
  const loadPlatformData = async (page: ParsedPage) => {
    const platforms = page.signals.platforms;
    if (platforms.some(platform => /shopify/i.test(platform))) {
      applyShopifyProducts(knowledge, shopifyProducts(await fetchText(`${origin}/products.json?limit=250`) ?? ""), origin);
    }
    if (platforms.some(platform => /wordpress/i.test(platform))) {
      for (const entry of wordpressPages(await fetchText(`${origin}/wp-json/wp/v2/pages?per_page=50&_fields=link,title,content`) ?? "", origin)) {
        enqueue(entry.url, rankUrl(new URL(entry.url), "") ?? 20, "Read from the WordPress REST API", entry.html);
      }
      applyWooProducts(knowledge, wooProducts(await fetchText(`${origin}/wp-json/wc/store/v1/products?per_page=50`) ?? ""), origin);
    }
    if (platforms.some(platform => /squarespace/i.test(platform))) {
      for (const entry of squarespacePages(await fetchText(`${origin}/?format=json`) ?? "", origin)) {
        enqueue(entry.url, rankUrl(new URL(entry.url), "") ?? 20, "Read from the Squarespace JSON data", entry.html);
      }
    }
  };

  while (queue.length && knowledge.crawl.pages.length < MAX_PAGES && !signal.aborted) {
    queue.sort((a, b) => b.priority - a.priority);
    const item = queue.shift()!; if (seen.has(item.url)) continue; seen.add(item.url);
    try {
      let body = item.html ?? ""; let finalUrl = item.url;
      if (item.html === undefined) {
        const response = await fetcher(item.url, { signal, beforeRequest: async next => {
          if (item.depth > 0 && next.origin !== origin) throw new Error("Skipped an off-site redirect.");
          await beforeRequest(next);
        } });
        if (response.status !== 200) throw new Error(`Website returned HTTP ${response.status}.`);
        if (!/text\/html|application\/xhtml\+xml/i.test(response.contentType)) throw new Error("Page did not return HTML.");
        body = response.body; finalUrl = response.url;
      }
      if (seen.has(finalUrl) && finalUrl !== item.url) continue;
      seen.add(finalUrl);
      if (item.depth === 0) origin = new URL(finalUrl).origin;
      let page = parsePage(body, finalUrl); let note = item.note;
      // Thin pages are usually client-rendered. Retry them in a headless browser, within a small render budget.
      if (item.html === undefined && page.mainText.length < 300 && options.renderer && renders < MAX_RENDERS && !signal.aborted) {
        renders++;
        const rendered = await options.renderer.render(finalUrl, signal).catch(() => null);
        if (rendered) {
          const candidate = parsePage(rendered, finalUrl);
          if (candidate.mainText.length > page.mainText.length) { page = candidate; note = "Rendered with a headless browser to read JavaScript content."; }
        }
      }
      extractInto(knowledge, page, item.depth === 0);
      knowledge.crawl.pages.push({ url: finalUrl, title: page.title, status: "success", message: note, meta: page.meta, headings: page.headings, content: page.mainText });
      if (page.blocks.join(" ").length < 150) knowledge.crawl.warnings.push(`Little readable HTML at ${finalUrl}. This page may need JavaScript rendering.`);
      if (item.depth === 0) {
        await loadPlatformData(page);
        await loadSitemaps();
        for (const link of discoverLinks(page, origin)) enqueue(link.url, link.priority);
      }
      // Second-step pages rank below first-step pages of the same kind, so the homepage's own links fill the budget first;
      // a bio two steps out (100 − 30) still outranks a first-step blog post (10). Only people, offering, FAQ, and policy pages
      // (rank 60+) are followed that far: older blog posts and thank-you pages there add time, not knowledge.
      if (item.depth === 1) for (const link of discoverLinks(page, origin)) if (link.priority >= 60) enqueue(link.url, link.priority - 30, undefined, undefined, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Page could not be retrieved.";
      knowledge.crawl.pages.push({ url: item.url, title: "", status: /disallowed|Skipped|crawl delay/.test(message) ? "skipped" : "failed", message, meta: {}, headings: [], content: "" });
      if (item.depth === 0) throw new Error(`Could not read the homepage: ${message}`);
    }
  }
  await options.renderer?.close().catch(() => undefined);
  if (signal.aborted) knowledge.crawl.warnings.push("The crawl reached its time limit; successful pages are included.");
  if (queue.length) knowledge.crawl.warnings.push("This is a bounded crawl, not a complete copy of the website. Additional pages may contain missing information.");
  knowledge.crawl.warnings.push("Inferred fields need review. Missing information is left blank; linked stylesheets and JavaScript-rendered content are not analyzed.");
  knowledge.crawl.completedAt = new Date().toISOString(); knowledge.updatedAt = knowledge.crawl.completedAt;
  finalizeKnowledge(knowledge);
  return knowledgeSchema.parse(knowledge);
}
