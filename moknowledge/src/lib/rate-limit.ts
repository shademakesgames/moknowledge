// A sliding-window limit per client, kept in this server process. Each server instance counts on its own, so a deployment with
// several instances needs a shared store (Redis, for example) for the limit to hold across them.
export function createRateLimiter({ limit, windowMs, now = Date.now }: { limit: number; windowMs: number; now?: () => number }) {
  const hits = new Map<string, number[]>();
  return {
    take(key: string): { allowed: boolean; retryAfterSeconds: number } {
      const time = now();
      const recent = (hits.get(key) ?? []).filter(hit => time - hit < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - time) / 1000)) };
      }
      recent.push(time); hits.set(key, recent);
      // Clients that have gone quiet are dropped, so the map cannot grow without bound.
      if (hits.size > 10_000) for (const [client, times] of hits) if (!times.some(hit => time - hit < windowMs)) hits.delete(client);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

// The client is the first address in X-Forwarded-For, which hosting proxies (Vercel, most load balancers) set. Run behind such a
// proxy: without one, a client can write its own header and every request would look like a new client.
export function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
}
