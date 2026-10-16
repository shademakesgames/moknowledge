import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { brotliDecompressSync, gunzipSync, inflateRawSync, inflateSync } from "node:zlib";
import ipaddr from "ipaddr.js";

export const USER_AGENT = "MoKnowledge/1.0 (business knowledge research)";
export function normalizeUrl(input: string): URL {
  const value = input.trim();
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error("Use a public HTTP or HTTPS website without credentials or custom ports.");
  }
  url.hash = "";
  return url;
}
export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === "unicast"; } catch { return false; }
}
export type PageResponse = { url: string; body: string; contentType: string; status: number };

// Some servers compress even when asked not to. Decompression is capped at the same size limit, so a small compressed body cannot expand without bound.
function decompress(raw: Buffer, contentEncoding: string, maxBytes: number): Buffer {
  const encoding = contentEncoding.trim().toLowerCase();
  const options = { maxOutputLength: maxBytes };
  try {
    if (!encoding || encoding === "identity") return raw;
    if (encoding === "gzip" || encoding === "x-gzip") return gunzipSync(raw, options);
    if (encoding === "br") return brotliDecompressSync(raw, options);
    if (encoding === "deflate") { try { return inflateSync(raw, options); } catch { return inflateRawSync(raw, options); } }
  } catch (error) {
    throw new Error(error instanceof RangeError ? "Page exceeds the download size limit." : "This website sent a compressed response that could not be read.");
  }
  throw new Error("This website requires an unsupported compressed response.");
}
// The charset comes from the Content-Type header, then a <meta> tag near the top of the page; UTF-8 is the fallback.
export function decodeBody(raw: Buffer, contentEncoding: string, contentType: string, maxBytes = 2_000_000): string {
  const bytes = decompress(raw, contentEncoding, maxBytes);
  const head = bytes.subarray(0, 2048).toString("latin1");
  const charset = (contentType.match(/charset=["']?([\w-]+)/i) || head.match(/<meta[^>]+charset=["']?([\w-]+)/i))?.[1] || "utf-8";
  try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder("utf-8").decode(bytes); }
}
type FetchOptions = { signal: AbortSignal; maxBytes?: number; beforeRequest?: (url: URL) => Promise<void> };

// Pin the validated address into the actual connection, while retaining the
// original hostname for Host and TLS certificate verification (no DNS race).
async function requestOnce(url: URL, options: FetchOptions): Promise<PageResponse & { location?: string }> {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(8000)]);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => reject(new Error("Website lookup timed out or was cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    lookup(hostname, { all: true }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
  if (!addresses.length || addresses.some(address => !isPublicAddress(address.address))) {
    throw new Error("Private, local, and reserved network destinations are not allowed.");
  }
  const address = addresses[0];
  const maxBytes = options.maxBytes ?? 2_000_000;
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      signal, agent: false, family: address.family,
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain;q=0.9,*/*;q=0.1", "Accept-Encoding": "gzip, deflate, br" },
    }, response => {
      response.on("error", reject);
      const status = response.statusCode ?? 502;
      const location = response.headers.location;
      const contentType = response.headers["content-type"] ?? "";
      if (status >= 300 && status < 400) {
        response.resume(); resolve({ url: url.href, body: "", contentType, status, location }); return;
      }
      if (Number(response.headers["content-length"]) > maxBytes) { response.destroy(new Error("Page exceeds the download size limit.")); return; }
      const contentEncoding = String(response.headers["content-encoding"] ?? "");
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) response.destroy(new Error("Page exceeds the download size limit."));
        else chunks.push(chunk);
      });
      response.on("end", () => {
        try { resolve({ url: url.href, body: decodeBody(Buffer.concat(chunks), contentEncoding, contentType, maxBytes), contentType, status }); }
        catch (error) { reject(error); }
      });
    });
    request.on("error", reject); request.end();
  });
}

export async function fetchPublicPage(input: string, options: FetchOptions): Promise<PageResponse> {
  let url = normalizeUrl(input);
  for (let redirects = 0; redirects <= 4; redirects++) {
    options.signal.throwIfAborted();
    await options.beforeRequest?.(url);
    const response = await requestOnce(url, options);
    if (response.status < 300 || response.status >= 400) return response;
    if (!response.location) throw new Error("Website sent a redirect without a destination.");
    url = normalizeUrl(new URL(response.location, url).href);
  }
  throw new Error("Website redirected too many times.");
}
