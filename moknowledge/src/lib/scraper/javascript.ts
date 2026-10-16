import type { CheerioAPI } from "cheerio";

export type EmbeddedProduct = { name: string; price: string };
export type ScriptSignals = { platforms: string[]; phones: string[]; emails: string[]; products: EmbeddedProduct[] };

// Signatures are matched against asset URLs, inline script text, and the generator meta tag. Scripts are never executed.
const TECH: [RegExp, string][] = [
  [/cdn\.shopify\.com|Shopify\.theme/i, "Shopify"], [/wp-content|wp-includes/i, "WordPress"], [/wixstatic|wix\.com/i, "Wix"],
  [/squarespace/i, "Squarespace"], [/webflow/i, "Webflow"], [/hubspot|hs-scripts/i, "HubSpot"], [/calendly/i, "Calendly"],
  [/intercom/i, "Intercom"], [/_next\/static|__NEXT_DATA__/i, "Next.js"], [/googletagmanager\.com\/gtag|google-analytics\.com|gtag\(/i, "Google Analytics"],
  [/googletagmanager\.com\/gtm|GTM-[A-Z0-9]{4,}/, "Google Tag Manager"], [/connect\.facebook\.net|fbq\(/i, "Meta Pixel"], [/hotjar/i, "Hotjar"],
];
const PHONE = /(?:\+?1[-.\s]?)?\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

// Reads one {...} literal from script source, respecting string literals, so the text can be parsed as data.
function balancedObject(source: string, start: number): string | null {
  let depth = 0; let quote: string | null = null;
  for (let i = start; i < source.length && i - start < 300000; i++) {
    const ch = source[i];
    if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  return null;
}

// Accepts strict JSON and JavaScript-style objects with bare keys. Anything else is ignored rather than guessed.
export function parseLooseJson(text: string): unknown {
  const bareKeysQuoted = text.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":').replace(/'/g, '"');
  for (const candidate of [text, bareKeysQuoted]) {
    try { return JSON.parse(candidate); } catch { /* Try the next form. */ }
  }
  return null;
}

function walk(value: unknown, visit: (object: Record<string, unknown>) => void, depth = 0) {
  if (depth > 12 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach(item => walk(item, visit, depth + 1)); return; }
  const object = value as Record<string, unknown>;
  visit(object);
  Object.values(object).forEach(child => walk(child, visit, depth + 1));
}

export function scriptSignals($: CheerioAPI, bodyText: string): ScriptSignals {
  const assets = $("script[src], link[href]").toArray().map(el => $(el).attr("src") || $(el).attr("href") || "");
  const inline = $("script:not([src])").toArray().map(el => ($(el).html() || "").slice(0, 400000));
  const generator = $('meta[name="generator"]').attr("content") || "";
  const haystack = [...assets, ...inline, generator].join("\n");
  const platforms = [...new Set([...(generator ? [generator.slice(0, 60)] : []), ...TECH.filter(([pattern]) => pattern.test(haystack)).map(([, label]) => label)])];

  // A malformed escape in one tel: link ("tel:%E0%A4%A") must not fail the page, so undecodable links are kept as written.
  const decode = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };
  const phones: string[] = $('a[href^="tel:"]').toArray().map(el => decode(($(el).attr("href") || "").replace(/^tel:/i, "")).trim());
  const emails: string[] = $('a[href^="mailto:"]').toArray().map(el => ($(el).attr("href") || "").replace(/^mailto:/i, "").split("?")[0].trim());
  phones.push(...(bodyText.match(PHONE) || []));
  emails.push(...(bodyText.match(EMAIL) || []));

  const products: EmbeddedProduct[] = [];
  const seen = new Set<string>();
  const addPhone = (value: unknown) => { if (typeof value === "string" && /\d{3}/.test(value)) phones.push(value); };
  const visit = (object: Record<string, unknown>) => {
    const name = [object.item_name, object.name, object.title].find(value => typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 120) as string | undefined;
    const price = [object.price, object.item_price, object.price_amount].find(value => (typeof value === "string" && /\d/.test(value)) || typeof value === "number");
    if (name && price !== undefined && products.length < 40 && !seen.has(name.trim().toLowerCase())) {
      seen.add(name.trim().toLowerCase()); products.push({ name: name.trim(), price: String(price) });
    }
    addPhone(object.telephone); addPhone(object.phone);
    if (typeof object.email === "string") emails.push(object.email);
  };

  $("script:not([src])").toArray().slice(0, 60).forEach(el => {
    const type = ($(el).attr("type") || "").toLowerCase();
    if (type === "application/ld+json") return; // Structured data is handled by the JSON-LD extractor.
    const source = ($(el).html() || "").slice(0, 400000);
    if (type.includes("json")) { const parsed = parseLooseJson(source); if (parsed) walk(parsed, visit); return; }
    // State objects (window.__INITIAL_STATE__ = {...}) and analytics pushes (dataLayer.push({...})).
    const pattern = /(?:=|push\()\s*\{/g; let match: RegExpExecArray | null; let scans = 0;
    while ((match = pattern.exec(source)) && scans++ < 40) {
      const body = balancedObject(source, match.index + match[0].length - 1);
      if (!body || body.length < 30) continue;
      const parsed = parseLooseJson(body);
      if (parsed) walk(parsed, visit);
    }
  });

  const cleanEmails = [...new Set(emails.map(email => email.trim()))].filter(email => !/\.(?:png|jpe?g|gif|svg|webp)$/i.test(email) && !/example\.|sentry|wixpress/i.test(email));
  const cleanPhones = [...new Set(phones.map(phone => phone.trim()).filter(Boolean))];
  return { platforms, phones: cleanPhones, emails: cleanEmails, products };
}
