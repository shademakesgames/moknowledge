import { emptyGroup, fieldText, offeringFields, type Entry, type Field, type Knowledge } from "../knowledge";

// Platform APIs and feeds that many small-business sites expose. Each one replaces guesswork on HTML with the site's own data.
type ProductLike = { name: string; description: string; category: string; pricing: string; images: string[] };
const now = () => new Date().toISOString();
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
export function safeUrl(value: string, base: string): string {
  try { const url = new URL(value, base); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; } catch { return ""; }
}
const absoluteSrc = (src: string | undefined, origin: string) => safeUrl(src?.startsWith("//") ? `https:${src}` : src ?? "", origin);
const pageHtml = (title: string, body: string) => `<html><head><title>${title}</title></head><body><main>${body}</main></body></html>`;
function setField(field: Field, value: string, url: string, locator: string) {
  if (!value.trim()) return;
  field.value = value.slice(0, 10000); field.status = "extracted"; field.sources = [{ url, excerpt: value.slice(0, 1800), locator, retrievedAt: now() }];
}
function setList(field: Field, values: string[], url: string, locator: string) {
  const unique = [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, 40);
  if (!unique.length) return;
  field.value = unique; field.status = "extracted"; field.sources = [{ url, excerpt: unique.join("; ").slice(0, 1800), locator, retrievedAt: now() }];
}
const priceText = (prices: number[]) => {
  if (!prices.length) return "";
  const min = Math.min(...prices).toFixed(2), max = Math.max(...prices).toFixed(2);
  return min === max ? min : `from ${min}`;
};

function addProduct(knowledge: Knowledge, product: ProductLike, url: string, locator: string) {
  const name = product.name.trim().slice(0, 120);
  if (!name || knowledge.offerings.length >= 60 || knowledge.offerings.some(entry => fieldText(entry.fields.name).toLowerCase() === name.toLowerCase())) return;
  const entry: Entry = { id: crypto.randomUUID(), fields: emptyGroup(offeringFields) };
  setField(entry.fields.name, name, url, locator);
  setField(entry.fields.type, "Product", url, locator);
  setField(entry.fields.category, product.category, url, locator);
  setField(entry.fields.description, product.description.slice(0, 600), url, locator);
  setField(entry.fields.pricing, product.pricing, url, locator);
  setList(entry.fields.images, product.images, url, locator);
  knowledge.offerings.push(entry);
}

// Shopify storefronts publish /products.json with names, prices, images, and descriptions.
type ShopifyProduct = { title?: string; body_html?: string; product_type?: string; variants?: { price?: string }[]; images?: { src?: string; alt?: string | null }[] };
export function shopifyProducts(body: string): ShopifyProduct[] {
  try { const data = JSON.parse(body) as { products?: unknown }; return Array.isArray(data.products) ? data.products as ShopifyProduct[] : []; } catch { return []; }
}
export function applyShopifyProducts(knowledge: Knowledge, products: ShopifyProduct[], origin: string) {
  for (const product of products) {
    const prices = (product.variants ?? []).map(variant => Number(variant.price)).filter(Number.isFinite);
    const images = (product.images ?? []).map(image => { const src = absoluteSrc(image.src, origin); return src ? `${src}${image.alt ? ` — ${image.alt}` : ""}` : ""; });
    addProduct(knowledge, { name: product.title || "", description: plain(product.body_html || ""), category: product.product_type || "", pricing: priceText(prices), images }, `${origin}/products.json`, "Shopify products.json");
  }
}

// WooCommerce's public Store API lists products with prices in minor currency units.
type WooProduct = { name?: string; description?: string; short_description?: string; prices?: { price?: string; currency_minor_unit?: number }; images?: { src?: string; alt?: string }[]; categories?: { name?: string }[] };
export function wooProducts(body: string): WooProduct[] {
  try { const data = JSON.parse(body) as unknown; return Array.isArray(data) ? data as WooProduct[] : []; } catch { return []; }
}
export function applyWooProducts(knowledge: Knowledge, products: WooProduct[], origin: string) {
  for (const product of products) {
    const value = Number(product.prices?.price) / 10 ** (product.prices?.currency_minor_unit ?? 2);
    const images = (product.images ?? []).map(image => { const src = absoluteSrc(image.src, origin); return src ? `${src}${image.alt ? ` — ${image.alt}` : ""}` : ""; });
    addProduct(knowledge, { name: plain(product.name || ""), description: plain(product.short_description || product.description || ""), category: product.categories?.[0]?.name || "", pricing: priceText(Number.isFinite(value) ? [value] : []), images }, `${origin}/wp-json/wc/store/v1/products`, "WooCommerce Store API");
  }
}

// WordPress REST pages arrive with rendered HTML, so they can be read without fetching each page.
type WordPressPage = { link?: string; title?: { rendered?: string }; content?: { rendered?: string } };
export function wordpressPages(body: string, origin: string): { url: string; html: string }[] {
  try {
    const data = JSON.parse(body) as unknown;
    return (Array.isArray(data) ? data as WordPressPage[] : []).flatMap(item => {
      const url = safeUrl(item.link || "", origin); const content = item.content?.rendered;
      return url && content && new URL(url).origin === origin ? [{ url, html: pageHtml(item.title?.rendered || "", content) }] : [];
    });
  } catch { return []; }
}

// Squarespace JSON exposes items with fullUrl, title, and body. The format is not documented, so this is best-effort.
export function squarespacePages(text: string, origin: string): { url: string; html: string }[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return []; }
  const found: { url: string; html: string }[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || found.length >= 50 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, depth + 1)); return; }
    const object = value as Record<string, unknown>;
    if (typeof object.fullUrl === "string" && typeof object.body === "string") {
      const url = safeUrl(object.fullUrl, origin);
      if (url && new URL(url).origin === origin) found.push({ url, html: pageHtml(typeof object.title === "string" ? object.title : "", object.body) });
    }
    Object.values(object).forEach(child => visit(child, depth + 1));
  };
  visit(data, 0);
  return found;
}

// Sitemaps list pages directly. Sitemap indexes point to child sitemaps, which the crawler fetches one level deep.
export function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(match => match[1].replace(/&amp;/g, "&"));
}
