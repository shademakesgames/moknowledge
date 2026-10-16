import type { Browser, Route } from "playwright-core";
import { fetchPublicPage, USER_AGENT } from "./fetch-page";

// Headless rendering reads content that only appears after JavaScript runs. It is optional: it needs playwright-core and a
// Chromium binary (CHROMIUM_PATH, or Playwright's bundled browser). Without them, render() returns null and the crawl continues.
export type Renderer = { render: (url: string, signal?: AbortSignal) => Promise<string | null>; close: () => Promise<void> };
const BLOCKED_TYPES = new Set(["image", "media", "font", "stylesheet"]);

// Chromium's sandbox stays on, because rendered pages are untrusted. A container that runs as root without user namespaces
// cannot start it; set CHROMIUM_NO_SANDBOX=1 there, and only where the container itself cannot reach private networks.
export function launchArgs(env: Record<string, string | undefined> = process.env): string[] {
  return [
    ...(env.CHROMIUM_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
    "--disable-dev-shm-usage",
    // WebRTC can send UDP straight to any address; without a usable proxy this keeps it off the network.
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  ];
}

// Text bodies reach the page re-encoded as UTF-8, so the declared charset must say so or the page renders garbled.
export function utf8ContentType(contentType: string): string {
  if (/charset=/i.test(contentType)) return contentType.replace(/charset=["']?[\w-]+["']?/i, "charset=utf-8");
  return /^(?:text\/|application\/(?:json|javascript|xhtml\+xml|xml))/i.test(contentType) ? `${contentType}; charset=utf-8` : contentType;
}

async function launch(): Promise<Browser | null> {
  try {
    const { chromium } = await import("playwright-core");
    return await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: launchArgs(),
      // Every request is answered by the route handler below, so Chromium itself should never connect anywhere. The proxy points
      // at a closed port, and "<-loopback>" removes Chromium's built-in localhost exemption, so anything that escapes routing
      // (WebSockets, for example) fails instead of reaching the network.
      proxy: { server: "http://127.0.0.1:9", bypass: "<-loopback>" },
    });
  } catch { return null; }
}

// The page's request is made by the same pinned fetcher the crawler uses: it resolves DNS once, rejects private and reserved
// addresses, and connects to the address it checked. Chromium never resolves or connects itself, so DNS rebinding cannot redirect it.
async function answer(route: Route, signal: AbortSignal) {
  const request = route.request();
  try {
    const target = new URL(request.url());
    if (!["http:", "https:"].includes(target.protocol) || BLOCKED_TYPES.has(request.resourceType()) || !["GET", "HEAD"].includes(request.method())) {
      await route.abort(); return;
    }
    const response = await fetchPublicPage(target.href, { signal });
    await route.fulfill({ status: response.status, contentType: utf8ContentType(response.contentType) || undefined, body: response.body });
  } catch { await route.abort().catch(() => undefined); }
}

export function createRenderer(): Renderer {
  let launching: Promise<Browser | null> | null = null;
  return {
    async render(url: string, signal?: AbortSignal) {
      if (signal?.aborted) return null;
      launching ??= launch();
      const browser = await launching;
      if (!browser || signal?.aborted) return null;
      const context = await browser.newContext({ userAgent: USER_AGENT, serviceWorkers: "block" });
      // Closing the context ends navigation and load waits at once, so a cancelled or timed-out crawl does not wait on the page.
      const stop = () => { void context.close().catch(() => undefined); };
      signal?.addEventListener("abort", stop, { once: true });
      const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000);
      try {
        const page = await context.newPage();
        await page.route("**/*", route => answer(route, requestSignal));
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
        return await page.content();
      } catch { return null; } finally { signal?.removeEventListener("abort", stop); await context.close().catch(() => undefined); }
    },
    async close() {
      const browser = launching ? await launching : null;
      launching = null;
      await browser?.close().catch(() => undefined);
    },
  };
}
