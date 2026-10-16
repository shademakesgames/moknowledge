import * as cheerio from "cheerio";
import { scriptSignals } from "./javascript";
import { emptyGroup, fieldText, offeringFields, personFields, type Entry, type Evidence, type Field, type Knowledge } from "../knowledge";

type Entity = Record<string, unknown>;
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const text = (value: unknown): string => typeof value === "string" || typeof value === "number" ? clean(String(value)) : "";
const object = (value: unknown): Entity => value && typeof value === "object" && !Array.isArray(value) ? value as Entity : {};
const values = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];
const FOOD_NOTICE = /\b(allerg(?:y|ies|ic)|raw or undercooked|may contain|gluten|consuming)\b/i;
const DISCLAIMER = /\b(disclaimer|not (?:legal|financial|medical|tax) advice|results (?:may|will) vary|no guarantee|terms apply|subject to (?:approval|availability|change)|for informational purposes)\b/i;
// Words that mark a capitalized phrase as a place, menu label, or page furniture ("Hours of Operation", "Sunset Rd.", "Independent CPA").
const NOT_A_PERSON = /\b(hours|operation|rd|st|street|road|blvd|boulevard|ave|avenue|drive|dr|suite|sunset|contact|our|we|it|this|that|team|office|services?|location|menu|independent|professional|certified|licensed|experienced|trusted|local|expert|leading|premier|the|and|group|company|partners?|tax|accounting|payroll|consulting|real|estate|homes?|privacy|policy|terms|listings?|sold|featured|blog|news|read|more|learn|book|schedule|new|best|top|free|cpa|cfo|ceo|llc|inc|corp)\b/i;
// A name word is Capitalized with lowercase letters ("DeAnna", "O'Brien") or an initial ("J."). ALL CAPS and sentence fragments do not match.
const PERSON_WORD = "(?:\\p{Lu}\\p{Ll}[\\p{L}'’-]*|\\p{Lu}\\.)";
const isPersonName = (name: string) => new RegExp(`^${PERSON_WORD}(?:\\s+${PERSON_WORD}){1,2}$`, "u").test(name) && !NOT_A_PERSON.test(name);
const LEGAL_SUFFIX = /,?\s+(?:LLC|L\.L\.C\.|LLP|PLLC|Inc\.?|Corp\.?|Corporation|Ltd\.?|Limited|P\.A\.|P\.C\.)$/i;
const letters = (value: string) => value.replace(/[^a-z0-9]/gi, "").toLowerCase();
// Titles mix the brand with places and taglines ("Bonefish Grill  Las Vegas,  NV"), so each part is a candidate brand.
const titleParts = (title: string) => {
  const parts = title.split(/\s[|–—•·:-]\s|,\s*/).map(part => part.replace(/\s+/g, " ").trim()).filter(part => letters(part).length >= 3);
  // Titles are whitespace-collapsed, so a brand can run into the city ("Bonefish Grill Las Vegas, NV"): its leading words are candidates too.
  return [...new Set(parts.flatMap(part => { const words = part.split(" "); return [part, ...[2, 3, 4].filter(count => count < words.length).map(count => words.slice(0, count).join(" "))]; }))];
};
// The legal name is the "Name, LLC" phrase a site repeats most ("JD and Associates, L.L.C. provides ..."). Footers often hold only a theme credit, so body copy counts too.
function legalNameFrom(fullText: string): string {
  const counts = new Map<string, { display: string; count: number }>();
  for (const match of fullText.matchAll(/((?:[A-Za-z][\w&'’.-]*,?\s+){0,3}[A-Z][\w&'’.-]*,?\s+(?:LLC|L\.L\.C\.|LLP|PLLC|Inc\.?|Corp\.?|Corporation|Ltd\.?|Limited|P\.A\.|P\.C\.))(?=[\s,.)]|$)/g)) {
    const display = clean(match[1]).replace(/^.*[a-z0-9]\.(?=[A-Z])/, "").replace(/,$/, "").replace(/^(?:(?:Toggle|Menu|Close|Open|Skip|Home|Search|Navigation)\s+)+/i, "");
    const key = display.toLowerCase();
    counts.set(key, { display: counts.get(key)?.display ?? display, count: (counts.get(key)?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.display.length - b.display.length)[0]?.display ?? "";
}
const cleanAddress = (value: string) => clean(value).replace(/,?\s+(?:US|USA|United States)$/i, "");
// Phones are compared by digits, so "+1 (702) 407-0980" and "702-407-0980" count once and share one format.
function normalizePhones(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const digits = value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    if (digits.length === 10 && !seen.has(digits)) seen.set(digits, `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`);
  }
  return [...seen.values()];
}
// Emails are case-insensitive. Image filenames and placeholder addresses that look like emails are not contacts.
function normalizeEmails(values: string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    // A phone number that touched the address in the markup leaves digits on the local part ("240-0532info@").
    const email = value.trim().toLowerCase().replace(/^[\d-]{6,}(?=[a-z])/, "");
    if (/\.(?:png|jpe?g|gif|webp|svg)$|@\dx|example\.|sentry|wixpress|no-?reply/.test(email)) continue;
    seen.add(email);
  }
  return [...seen];
}
// Pages are merged one at a time, so list fields grow with every page. These caps keep the site-wide summary readable.
export function finalizeKnowledge(knowledge: Knowledge) {
  const { foundation, market, branding, insights } = knowledge.sections;
  const caps: [Field, number][] = [[branding.colors, 8], [branding.fonts, 4], [foundation.phones, 5], [foundation.emails, 5], [market.ctas, 8], [insights.topics, 15]];
  for (const [field, cap] of caps) if (Array.isArray(field.value)) field.value = field.value.slice(0, cap);
}
// Generic and system font stacks say nothing about the brand, so only a named family counts.
const GENERIC_FONT = /^(?:-?apple-system|blinkmacsystemfont|system-ui|sans-serif|serif|monospace|cursive|fantasy|arial|helvetica(?: neue)?|times(?: new roman)?|georgia|verdana|tahoma|courier(?: new)?|segoe ui|ubuntu|cantarell|oxygen(?:-sans)?)$/i;
// WordPress ships these as default palette swatches, so they say nothing about the brand.
const WP_DEFAULT_COLORS = new Set(["#abb8c3", "#f78da7", "#cf2e2e", "#ff6900", "#fcb900", "#7bdcb5", "#00d084", "#8ed1fc", "#0693e3", "#9b51e0", "#eb144c"]);
// An image entry keeps its caption so a reviewer can tell which menu item or product a picture belongs to.
const IMAGE_JUNK = /logo|icon|sprite|avatar|pixel|spacer|badge|payment|social|tracking|placeholder|blank|favicon/i;
const imageEntry = (src: string, alt: string) => src && !/\.svg(?:[?#]|$)/i.test(src) && !IMAGE_JUNK.test(`${src} ${alt}`) ? `${src}${alt ? ` — ${alt.slice(0, 120)}` : ""}` : "";
// Lazy-loading sites keep the real image in data-* attributes, srcset, or inline backgrounds.
function bestImageSrc(attr: (name: string) => string | undefined, base: string): string {
  const candidates: (string | undefined)[] = [attr("src"), attr("data-src"), attr("data-lazy-src"), attr("data-original")];
  const srcset = attr("srcset") || attr("data-srcset");
  if (srcset) candidates.push(srcset.split(",").map(part => part.trim().split(/\s+/)[0]).pop());
  const background = (attr("style") || "").match(/url\(["']?([^"')]+)/);
  if (background) candidates.push(background[1]);
  const width = Number(attr("width"));
  if (width && width < 80) return "";
  return candidates.map(candidate => absolute(candidate, base)).find(Boolean) || "";
}
// Calls to action, phone numbers, and emails are page furniture, not business facts.
const NOISE = /\b(contact us|call us|call today|email us|click here|sign up|subscribe|book (?:a|an|your|now|online)|schedule (?:a|an|your|now|online)|get started|learn more|read more)\b|\(\d{3}\)\s?\d{3}-\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b|@|\b(?:cookies?|trademarks?|copyright|all rights reserved|user agreement|privacy notice|terms of use)\b|©/i;
// Claims are kept sentence by sentence so one long intro paragraph cannot become a single "need" or "differentiator".
// A kept sentence ends with punctuation, so navigation labels and headings ("Read More", "Radiological Product Specialization") are dropped.
const keptSentences = (blocks: string[]) => [...new Set(blocks.flatMap(block => block.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).map(sentence => sentence.trim())))].filter(sentence => sentence.length >= 25 && sentence.length <= 280 && /[.!?)"”]$/.test(sentence) && !NOISE.test(sentence));
function normalizeColor(raw: string): string {
  let hex = raw.slice(1).toLowerCase();
  if (hex.length === 8 && hex.endsWith("00")) return ""; // Fully transparent.
  if (hex.length === 8) hex = hex.slice(0, 6);
  if (hex.length === 4) hex = hex.slice(0, 3);
  if (hex.length === 3) hex = [...hex].map(ch => ch + ch).join("");
  return "#" + hex;
}
const isNeutral = (color: string) => { const channels = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16)); return Math.max(...channels) - Math.min(...channels) < 16; };
function named(value: unknown): string { return text(value) || text(object(value).name); }
function absolute(value: unknown, base: string): string {
  try { const url = new URL(text(value), base); return text(value) && ["http:", "https:"].includes(url.protocol) ? url.href : ""; } catch { return ""; }
}
function entities(value: unknown): Entity[] {
  if (Array.isArray(value)) return value.flatMap(entities);
  if (!value || typeof value !== "object") return [];
  const item = value as Entity;
  return [...(item["@type"] ? [item] : []), ...Object.values(item).filter(value => value && typeof value === "object").flatMap(entities)];
}
function types(entity: Entity) { return values(entity["@type"]).map(String); }
function address(value: unknown): string { const obj = object(value); return text(value) || [obj.streetAddress, obj.addressLocality, obj.addressRegion, obj.postalCode, named(obj.addressCountry)].map(text).filter(Boolean).join(", "); }

export function parsePage(html: string, url: string) {
  const $ = cheerio.load(html);
  // Block boundaries become spaces, so text from adjacent elements ("missions.</p><p>JD") does not run together.
  $("p,li,div,section,article,main,header,footer,nav,aside,h1,h2,h3,h4,h5,h6,address,blockquote,tr,td,th,dd,dt,figure,figcaption,ul,ol,table").each((_index, el) => { $(el).prepend(" ").append(" "); });
  $("br,hr").each((_index, el) => { $(el).replaceWith(" "); });
  const structured: Entity[] = [];
  $('script[type="application/ld+json"]').each((_index, el) => { try { structured.push(...entities(JSON.parse($(el).text()))); } catch { /* Other blocks remain usable. */ } });
  const links = $("a[href]").toArray().flatMap(el => {
    const href = absolute($(el).attr("href"), url);
    return href ? [{ url: href, text: clean($(el).text()) }] : [];
  });
  const title = clean($("title").first().text());
  const description = clean($('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "");
  const siteName = clean($('meta[property="og:site_name"]').attr("content") || "");
  const styleText = $("style").text() + " " + $("[style]").toArray().map(el => $(el).attr("style")).join(" ");
  const content = $("body").clone();
  content.find('script, style, nav, header, footer, noscript, svg, dialog, [role="dialog"], [hidden], [aria-hidden="true"], [class*="modal"], [id*="cookie"], [class*="cookie-banner"]').remove();
  const blocks = content.find("h1,h2,h3,p,li,address,blockquote").toArray().map(el => clean($(el).text())).filter(value => value.length > 15 && value.length < 2000);
  const footerSentences = clean($("footer, [role=contentinfo]").text()).split(/(?<=[.!?])\s+/);
  const bodyCopy = $("body").clone(); bodyCopy.find("script, style, noscript").remove();
  const fullText = clean(bodyCopy.text());
  const meta: Record<string, string> = {};
  $("meta").toArray().slice(0, 150).forEach(el => {
    const key = ($(el).attr("name") || $(el).attr("property") || $(el).attr("http-equiv") || "").trim().toLowerCase();
    const value = clean($(el).attr("content") || "").slice(0, 500);
    if (key && value && Object.keys(meta).length < 80) meta[key] = value;
  });
  const canonical = absolute($('link[rel="canonical"]').attr("href"), url); if (canonical) meta.canonical = canonical;
  const appleIcon = absolute($('link[rel~="apple-touch-icon"]').attr("href"), url); if (appleIcon) meta["apple-touch-icon"] = appleIcon;
  const language = clean($("html").attr("lang") || "").slice(0, 20); if (language) meta.lang = language;
  const headings = content.find("h1,h2,h3").toArray().map(el => clean($(el).text())).filter(value => value.length > 1 && value.length < 200).slice(0, 60);
  const mainRoot = $("main, article, [role=main]").first();
  const mainCopy = mainRoot.length ? mainRoot.clone() : content.clone();
  mainCopy.find("nav, aside, form, button, script, style, noscript, [class*=cookie], [id*=cookie]").remove();
  const mainText = clean(mainCopy.text()).slice(0, 12000);
  const signals = scriptSignals($, clean(content.text()));
  return { $, content, url, title, description, siteName, links, structured, styleText, blocks, footerSentences, fullText, meta, headings, mainText, signals };
}
export type ParsedPage = ReturnType<typeof parsePage>;

export function extractInto(knowledge: Knowledge, page: ParsedPage, isHome: boolean) {
  const { $, url, structured, blocks } = page;
  const evidence = (excerpt: string, locator: string): Evidence => ({ url, excerpt: excerpt.slice(0, 1800), locator, retrievedAt: new Date().toISOString() });
  const put = (field: Field, value: string | string[], locator: string, inferred = false, replace = false) => {
    const result = Array.isArray(value) ? [...new Set(value.map(clean).filter(Boolean))].slice(0, 40) : clean(value).slice(0, 10000);
    if (!result.length) return;
    const source = evidence(Array.isArray(result) ? result.join("; ") : result, locator);
    if (Array.isArray(result) && Array.isArray(field.value)) {
      field.value = [...new Set([...field.value, ...result])].slice(0, 40);
      if (field.sources.length < 20 && !field.sources.some(item => item.url === url && item.locator === locator)) field.sources.push(source);
    } else if (!fieldText(field) || replace) { field.value = result; field.status = inferred ? "inferred" : "extracted"; field.sources = [source]; }
    else if (fieldText(field) !== (Array.isArray(result) ? result.join("\n") : result) && field.sources.length < 10 && !field.sources.some(item => item.url === url && item.excerpt === source.excerpt)) {
      field.sources.push(source); // Alternate evidence stays available for review.
    }
  };
  const { foundation: f, positioning: p, market: m, branding: b, presence, insights } = knowledge.sections;
  const legalName = legalNameFrom(page.fullText);
  let domainBrand = "";
  if (isHome) {
    put(f.website, url, "final response URL");
    const hostWord = letters(new URL(url).hostname.replace(/^www\./, ""));
    const logoAlt = ($('img[alt*="logo" i]').first().attr("alt") || "").replace(/\blogo\b/i, "");
    const legalBrand = legalName.replace(LEGAL_SUFFIX, "").trim();
    const nameCandidates = [...titleParts(page.title), clean(logoAlt), legalBrand, page.siteName].filter(candidate => letters(candidate).length >= 3);
    // og:site_name is often keyword-stuffed ("Kelly Jones Scottsdale Luxury Real Estate Agent"), so the brand the domain spells out wins.
    domainBrand = nameCandidates.find(candidate => hostWord.includes(letters(candidate))) || "";
    put(f.name, domainBrand || legalBrand || titleParts(page.title)[0] || page.siteName, "brand matching the domain, footer legal name, or title");
    put(f.overview, page.description || blocks.find(value => value.length > 100) || "", "meta description / first content paragraph");
    put(m.channels, [url], "company website");
  }
  // Legal and compliance signals: same-site policy links, licensing text, regulatory notices, and named frameworks.
  const legalSection = knowledge.sections.legal;
  const sameSite = (href: string) => new URL(href).hostname.replace(/^www\./, "") === new URL(url).hostname.replace(/^www\./, "");
  const privacyLink = page.links.find(link => sameSite(link.url) && (/privacy/i.test(new URL(link.url).pathname) || /^privacy( policy)?$/i.test(link.text)));
  if (privacyLink) put(legalSection.privacyPolicyUrl, privacyLink.url, "same-site privacy link");
  const termsLink = page.links.find(link => sameSite(link.url) && (/terms|conditions/i.test(new URL(link.url).pathname) || /^(terms|terms of (?:use|service)|conditions)$/i.test(link.text)));
  if (termsLink) put(legalSection.termsUrl, termsLink.url, "same-site terms link");
  const pageSentences = keptSentences([...blocks, ...page.footerSentences]);
  put(legalSection.licenses, [...page.fullText.matchAll(/\b(?:license|lic\.?|NMLS|registration)\s*(?:#|no\.?|number:?)\s*[A-Z0-9-]{4,}/gi)].map(match => match[0]).slice(0, 5), "license number on page");
  put(legalSection.licenses, pageSentences.filter(sentence => /\b((?:is|we are|are|state|fully)\s+licen[cs]ed|licensed (?:by|with|in)|license (?:no\.?|number|#)|registration (?:no\.?|number)|registered with|accredited by)\b/i.test(sentence)).slice(0, 5), "license and registration statements");
  put(legalSection.regulatoryNotes, pageSentences.filter(sentence => /\b(regulated by|not (?:a|an) (?:bank|law firm|financial advisor|medical provider)|not (?:legal|financial|medical|tax) advice|consult (?:a|your) (?:licensed|qualified|professional))\b/i.test(sentence)).slice(0, 5), "regulatory and advice notices");
  const frameworks: [RegExp, string][] = [[/\bHIPAA\b/, "HIPAA"], [/\bGDPR\b/, "GDPR"], [/\bCCPA\b|\bCPRA\b/, "CCPA / CPRA"], [/\bPCI[- ]DSS\b/i, "PCI DSS"], [/\bSOC ?2\b/, "SOC 2"], [/\bISO ?27001\b/, "ISO 27001"], [/\bFINRA\b/, "FINRA"], [/\bFDIC\b/, "FDIC"], [/\bCOPPA\b/, "COPPA"], [/\bWCAG\b/, "WCAG accessibility"]];
  put(legalSection.compliance, frameworks.filter(([pattern]) => pattern.test(page.fullText)).map(([, label]) => label), "compliance keywords in page text", true);
  const pathname = new URL(url).pathname;
  // Policy pages legitimately say "contact us", so only the length filter applies there.
  const policyText = blocks.filter(block => block.length >= 40 && block.length <= 600 && /[.!?]$/.test(block));
  if (/privacy/i.test(pathname)) { put(legalSection.privacyPolicyUrl, url, "privacy policy page"); put(legalSection.dataPractices, policyText.slice(0, 6), "privacy policy text", true); }
  if (/terms|conditions/i.test(pathname)) put(legalSection.termsUrl, url, "terms page");
  if (/disclaimer|legal|licens|compliance|accessib/i.test(pathname)) put(legalSection.regulatoryNotes, policyText.filter(block => /\b(disclaim|as is|no warrant|liabilit|regulat|licens|complian|accessib|governed by|jurisdiction|not (?:legal|financial|medical|tax) advice)/i.test(block)).slice(0, 6), "legal or disclaimer page text", true);
  put(legalSection.dataPractices, pageSentences.filter(sentence => /\b(personal (?:data|information)|cookies?|third[- ]part(?:y|ies)|your data|we (?:collect|store|share))\b/i.test(sentence)).slice(0, 5), "data and privacy statements", true);
  const organizations = structured.filter(item => types(item).some(type => /Organization|LocalBusiness|ProfessionalService|Corporation|AccountingService|Store|Restaurant|MedicalBusiness|LegalService/.test(type)));
  for (const org of organizations) {
    const orgUrl = absolute(org.url, url);
    if (orgUrl && new URL(orgUrl).hostname.replace(/^www\./, "") !== new URL(url).hostname.replace(/^www\./, "")) continue;
    if (/publisher|agency|web design/i.test(named(org)) && !orgUrl) continue;
    // A brand that matches the domain ("Bonefish Grill") outranks a shorter JSON-LD name ("Bonefish").
    put(f.name, named(org), "JSON-LD organization.name", false, isHome && !domainBrand);
    put(f.overview, text(org.description), "JSON-LD organization.description", false, isHome);
    const founded = text(org.foundingDate).match(/\b(?:18|19|20)\d{2}\b/)?.[0];
    put(f.yearFounded, founded || "", "JSON-LD foundingDate");
    put(f.alternativeNames, [...values(org.alternateName).map(named), text(org.legalName)].filter(Boolean), "JSON-LD alternateName / legalName");
    put(f.mainAddress, cleanAddress(address(values(org.address)[0])), "JSON-LD address");
    put(f.otherLocations, values(org.address).slice(1).map(address), "JSON-LD addresses");
    put(f.serviceLocations, values(org.areaServed).map(named), "JSON-LD areaServed");
    put(f.employeeCount, text(org.numberOfEmployees) || text(object(org.numberOfEmployees).value), "JSON-LD numberOfEmployees");
    put(f.industry, text(org.industry), "JSON-LD industry");
    const jsonLogo = absolute(text(org.logo) || object(org.logo).url || object(org.logo).contentUrl, url);
    if (jsonLogo) { put(b.logos, [jsonLogo], "JSON-LD logo"); put(f.logo, jsonLogo, "JSON-LD logo"); }
    for (const social of values(org.sameAs)) collectSocial(text(social), presence, put);
  }
  for (const link of page.links) collectSocial(link.url, presence, put);
  const logo = $("header img, [class*=logo] img, img[class*=logo]").toArray().filter(el => /logo|brand/i.test([$(el).attr("alt"), $(el).attr("src"), $(el).attr("class")].join(" "))).map(el => absolute($(el).attr("src"), url)).filter(Boolean);
  put(b.logos, logo.slice(0, 4), "header / logo image candidates", true);
  put(f.logo, logo[0] || "", "header logo image", true);
  put(f.logo, page.meta["apple-touch-icon"] || "", "apple-touch-icon", true);
  const colorCounts = new Map<string, number>();
  for (const match of page.styleText.matchAll(/#([\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b/gi)) {
    const color = normalizeColor(match[0]); if (!color) continue;
    colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
  }
  // Brand colors only: neutrals and WordPress default swatches are page furniture, not identity.
  const rankedColors = [...colorCounts].sort((a, c) => c[1] - a[1]).map(([color]) => color).filter(color => !isNeutral(color) && !WP_DEFAULT_COLORS.has(color));
  put(b.colors, rankedColors.slice(0, 6), "inline styles / style blocks, most used brand colors", true);
  const fonts = [...page.styleText.matchAll(/font-family\s*:\s*([^;}]+)/gi)].map(match => match[1].split(",")[0].replace(/["']/g, "").trim()).filter(value => value && value.length < 40 && !GENERIC_FONT.test(value) && !/[<>:{}]|^(?:inherit|initial|unset|var\()/i.test(value));
  put(b.fonts, [...new Set(fonts)].slice(0, 6), "inline font-family declarations", true);
  const fullName = [fieldText(f.name), legalName, $("footer").text()].join(" ");
  const legalMatch = fullName.match(/(?:^|[\s,])(LLC|L\.L\.C\.|LLP|PLLC|Ltd|Inc|Corp|Corporation|Limited)(?=[\s,.)]|$)/i)?.[1];
  const legal = legalMatch && (/^l\.?l\.?c\.?$/i.test(legalMatch) ? "LLC" : legalMatch.replace(/^\w/, letter => letter.toUpperCase()));
  if (legal) put(f.legalEntityType, legal, "company name / footer legal entity suffix");
  const foundedBlock = blocks.find(value => /\b(founded|established|started (?:the|our|his|her) (?:company|business|practice))\b.{0,65}\b(?:18|19|20)\d{2}\b/i.test(value) || /\bsince (?:18|19|20)\d{2}.{0,40}(?:my|our) own .{0,30}(?:practice|business|company)/i.test(value));
  if (foundedBlock) {
    put(f.yearFounded, foundedBlock.match(/\b(?:18|19|20)\d{2}\b/)?.[0] || "", "explicit founding statement");
    if (f.yearFounded.sources[0]) f.yearFounded.sources[0].excerpt = foundedBlock;
    put(p.foundingStory, foundedBlock, "founding statement");
  }
  put(f.mainAddress, cleanAddress($("address").first().text()), "address element");
  // Accordion and arrow decorations are stripped from labels ("Contact UsExpand →" becomes "Contact Us"), and each URL is listed once.
  const ctaLinks = page.links.map(link => ({ url: link.url, label: clean(link.text).replace(/\s*(?:→|»|›)\s*|Expand\b/gi, " ").replace(/\s+/g, " ").trim() })).filter(link => /^(get started|contact us|book|schedule|request|subscribe|sign up|buy|shop|learn more|make an appointment|start)/i.test(link.label) && link.label.length < 60);
  put(m.ctas, [...new Map(ctaLinks.map(link => [link.url, `${link.label} — ${link.url}`])).values()].slice(0, 12), "action links");
  const funnels = [$("form").length ? "Website form" : "", page.links.some(link => /calendly|schedule|booking|appointment/i.test(link.url + link.text)) ? "Appointment / booking link" : "", /newsletter|subscribe/i.test(blocks.join(" ")) ? "Newsletter signup mention" : ""].filter(Boolean);
  put(m.funnels, funnels, "forms and signup / booking links", true);
  put(m.targetBuyers, keptSentences(blocks).filter(value => /\b(we (?:serve|help|work with)|for (?:small businesses|homeowners|families|entrepreneurs)|our clients include)\b/i.test(value)).slice(0, 5), "explicit audience statements");
  put(m.customerNeeds, keptSentences(blocks).filter(value => /\b(help you|struggling with|challenges? (?:you|of)|save (?:time|money))\b/i.test(value)).slice(0, 4), "customer problem / benefit statements", true);
  put(p.differentiators, keptSentences(blocks).filter(value => /\b(unlike|sets us apart|why choose|our difference|uniquely|specializ)/i.test(value)).slice(0, 4), "differentiation statements");
  put(m.partners, keptSentences(blocks).filter(value => /\b(our partners include|partnered with|partnership with|authorized (?:dealer|partner)|certified partner of)\b/i.test(value)).slice(0, 5), "explicit partner statements");
  put(insights.certifications, keptSentences(blocks).filter(value => /\b(certified|accredited|award-winning|certification|ProAdvisor|member of)\b/i.test(value)).slice(0, 6), "credential statements (not independently verified)");
  put(insights.claims, keptSentences(blocks).filter(value => /\b(disclaimer|not (?:legal|financial|medical) advice|results (?:may|will) vary|no guarantee|terms apply)\b/i.test(value)).slice(0, 6), "disclaimer statements");
  put(insights.promotions, keptSentences(blocks).filter(value => /\b(offer|sale|discount|promotion)\b/i.test(value) && /\b(?:20\d{2}|expires|valid until)\b/i.test(value)).slice(0, 4), "dated promotion text; verify expiry before use");
  if (/blog|article|insight|news/.test(new URL(url).pathname)) put(insights.topics, [clean($("h1").first().text())], "article heading", true);

  for (const entity of structured) {
    const kind = types(entity);
    if (kind.includes("Person") && named(entity) && (entity.jobTitle || entity.worksFor || entity.description) && !/blog|article/.test(new URL(url).pathname)) {
      if (knowledge.people.some(person => fieldText(person.fields.name).toLowerCase() === named(entity).toLowerCase())) continue;
      const person: Entry = { id: crypto.randomUUID(), fields: emptyGroup(personFields) };
      put(person.fields.name, named(entity), "JSON-LD Person.name"); put(person.fields.title, text(entity.jobTitle), "JSON-LD jobTitle");
      put(person.fields.role, text(entity.roleName), "JSON-LD roleName"); put(person.fields.gender, text(entity.gender), "JSON-LD explicitly stated gender");
      put(person.fields.background, text(entity.description), "JSON-LD Person.description"); knowledge.people.push(person);
    }
    if (kind.some(type => ["Product", "Service", "MenuItem"].includes(type)) && named(entity)) {
      if (knowledge.offerings.some(offering => fieldText(offering.fields.name).toLowerCase() === named(entity).toLowerCase())) continue;
      const offering: Entry = { id: crypto.randomUUID(), fields: emptyGroup(offeringFields) };
      put(offering.fields.name, named(entity), "JSON-LD offering.name"); put(offering.fields.type, kind.includes("MenuItem") ? "Menu item" : kind.includes("Product") ? "Product" : "Service", "JSON-LD @type");
      put(offering.fields.description, text(entity.description), "JSON-LD offering.description"); put(offering.fields.category, named(entity.category) || text(entity.serviceType), "JSON-LD category / serviceType");
      put(offering.fields.features, values(entity.additionalProperty).map(item => `${named(item)}: ${text(object(item).value)}`), "JSON-LD additionalProperty");
      const prices = values(entity.offers).map(item => { const offer = object(item); return [text(offer.priceCurrency), text(offer.price) || (offer.lowPrice != null ? `from ${text(offer.lowPrice)}` : ""), text(offer.description), text(object(offer.priceSpecification).unitText)].filter(Boolean).join(" "); }).filter(Boolean);
      put(offering.fields.pricing, prices.join("; "), "JSON-LD offers; preserve qualifiers");
      put(offering.fields.images, values(entity.image).map(item => { const obj = object(item); return imageEntry(absolute(typeof item === "string" ? item : text(obj.url) || text(obj.contentUrl), url), typeof item === "string" ? "" : text(obj.caption) || text(obj.name)); }).filter(Boolean), "JSON-LD image");
      knowledge.offerings.push(offering);
    }
    if (kind.includes("Question")) put(insights.faqs, [`${named(entity)} — ${text(object(values(entity.acceptedAnswer)[0]).text)}`], "JSON-LD Question / acceptedAnswer");
    if (kind.includes("Review") && text(entity.reviewBody)) put(insights.testimonials, [`${text(entity.reviewBody)} — ${named(entity.author) || "Attribution not provided"}`], "JSON-LD review (first-party claim)");
  }
  // Biography pages often use headings and prose instead of Person JSON-LD. They live under /team/… or at a bare slug such as /kelly-jones/,
  // where the page title is the person's name, so the title match is what identifies them.
  const bioPath = /\/(?:about-us|team|people|staff|leadership)\/.+/i.test(new URL(url).pathname);
  const pageTitleName = page.title.split(/\s[|–—]\s/)[0].trim().toLowerCase();
  // The word right after the name ("Elizabeth Flynn Assistant ...") is the role; it is required on non-bio pages so that headings like "Privacy Policy" are not people.
  const roleAfterName = (name: string) => page.mainText.slice(0, 400).split(name)[1]?.match(/^\s+((?:Founding |Managing )?(?:Founder|Co-Founder|CEO|President|Director|Owner|Partner|Principal|Assistant|Associate|Agent|Broker|Realtor))\b/)?.[1];
  const bioCandidate = page.content.find("h1,h2").toArray().map(el => clean($(el).text())).find(heading => {
    const name = heading.split(",")[0].trim();
    if (!isPersonName(name) || !/^[^,]+(?:,\s*(?:CPA|PhD|MD|JD|CFP|Esq\.?))?$/.test(heading)) return false;
    return bioPath ? page.title.toLowerCase().includes(name.toLowerCase()) : pageTitleName === name.toLowerCase() && Boolean(roleAfterName(name));
  });
  if (bioCandidate && !knowledge.people.some(person => fieldText(person.fields.name).split(",")[0] === bioCandidate.split(",")[0])) {
    const person: Entry = { id: crypto.randomUUID(), fields: emptyGroup(personFields) };
    const personName = bioCandidate.split(",")[0];
    put(person.fields.name, personName, "biography page heading", true);
    put(person.fields.title, bioCandidate.includes(",") ? bioCandidate.split(",").slice(1).join(",").trim() : "", "credentials in biography heading");
    // Role comes from the page title when it names one, otherwise from the word right after the name.
    const titleRole = page.title.match(/\b(Founder|Co-Founder|CEO|President|Director|Owner|Partner)\b/i)?.[0];
    put(person.fields.role, titleRole || roleAfterName(personName) || "", "biography page title or opening text");
    put(person.fields.background, blocks.filter(value => value.length > 100).slice(0, 3).join("\n"), "biography paragraphs");
    knowledge.people.push(person);
  }
  // Founders and owners are often named in running text ("our founder, Doug Cohen") on pages that have no bio of their own.
  const COMPANY_WORD = /\b(?:LLC|Inc|Corp|Services?|Consulting|Group|Company|Firm|Associates|Partners|Solutions|Studio|Agency)\b/i;
  // Headline and card words ("Your Trusted Partner", "Read Bio", "Real Estate Agent") are capitalized too, so they are excluded from names.
  const NOT_NAME_WORD = "(?!(?:Your|Our|The|My|Meet|Read|Bio|Real|Estate|Luxury|Trusted|Premier|Featured|Explore|Discover|Work|Founding|Managing|Senior|Lead|Scottsdale|Phoenix|Arizona|Paradise|Valley|Arcadia|Team|Group|Assistant|Partner|Agent|Broker)\\b)";
  const NAME = `((?:${NOT_NAME_WORD}${PERSON_WORD})(?:\\s+${NOT_NAME_WORD}${PERSON_WORD}){1,2})`;
  const ROLE = "((?:[Ff]ounding |[Mm]anaging )?(?:[Ff]ounder|[Cc]o-[Ff]ounder|[Oo]wner|[Pp]resident|CEO|[Pp]rincipal|[Pp]artner|[Dd]irector|CFO|[Cc]ontroller|[Aa]ssistant|[Aa]ssociate|[Aa]gent|[Bb]roker|[Rr]ealtor))";
  const proseText = blocks.join(" ");
  const addProsePerson = (name: string, role: string) => {
    if (!name || !role || COMPANY_WORD.test(name) || !isPersonName(name)) return;
    if (knowledge.people.some(person => fieldText(person.fields.name).toLowerCase() === name.toLowerCase())) return;
    const person: Entry = { id: crypto.randomUUID(), fields: emptyGroup(personFields) };
    put(person.fields.name, name, "name stated in page text", true);
    put(person.fields.role, role.replace(/\b\w/g, letter => letter.toUpperCase()), "role stated in page text", true);
    knowledge.people.push(person);
  };
  // "our founder, Doug Cohen"
  for (const match of proseText.matchAll(new RegExp(`\\b(?:[Oo]ur|[Mm]y|[Tt]he)\\s+${ROLE}\\b,?\\s+(?:is\\s+)?${NAME}`, "gu"))) addProsePerson(match[2], match[1]);
  // "Doug Cohen, our founder" / "Doug Cohen is the founder"
  for (const match of proseText.matchAll(new RegExp(`\\b${NAME},?\\s+(?:is\\s+)?(?:[Oo]ur|[Tt]he|a)?\\s*${ROLE}\\b`, "gu"))) addProsePerson(match[1], match[2]);
  $("details").each((_i, el) => {
    const summary = clean($(el).find("summary").text()); const copy = $(el).clone(); copy.find("summary").remove();
    if (summary.endsWith("?") && clean(copy.text())) put(insights.faqs, [`${summary} — ${clean(copy.text()).slice(0, 1500)}`], "details / summary FAQ");
  });
  $("blockquote").each((_i, el) => {
    const quote = clean($(el).text()); const attribution = clean($(el).find("cite").text()) || clean($(el).parent().find("figcaption").text());
    if (quote.length > 30 && attribution) put(insights.testimonials, [`${quote} — ${attribution}`], "attributed blockquote (not independently verified)");
  });
  // A detail page gives useful offering candidates even without structured data.
  const path = new URL(url).pathname;
  // Articles often mention services in their slug ("/blog/the-most-common-accounting-mistakes"), so they are never offering pages.
  const articlePage = /\/(?:blog|news|articles?|insights?|posts?)(?:\/|$)/i.test(path);
  const servicePage = !articlePage && (/\/(?:services?|products?|solutions?)\/.+/i.test(path) || /(?:tax-preparation|bookkeeping|payroll|quickbooks|accounting|cfo)/i.test(path));
  if (servicePage && knowledge.offerings.length < 30) {
    const heading = clean($("main h1, h1").first().text()) || page.title.split(/\s[|–—]\s/)[0];
    if (heading && !knowledge.offerings.some(entry => fieldText(entry.fields.name).toLowerCase() === heading.toLowerCase() || entry.fields.name.sources.some(source => source.url === url))) {
      const entry: Entry = { id: crypto.randomUUID(), fields: emptyGroup(offeringFields) };
      put(entry.fields.name, heading, "offering detail page heading", true);
      put(entry.fields.type, /products?/i.test(path) ? "Product" : "Service", "offering URL path", true);
      put(entry.fields.description, page.description || blocks.find(value => value.length > 100) || "", "offering description");
      put(entry.fields.features, $("main li, article li").toArray().map(el => clean($(el).text())).filter(value => value.length > 20 && value.length < 400).slice(0, 8), "offering content list", true);
      put(entry.fields.pricing, blocks.find(value => /(?:[$£€]\s?\d|contact .{0,20}(?:pricing|quote)|per month|per year)/i.test(value)) || "", "pricing statement");
      put(entry.fields.images, $("main img, article img, figure img, [class*=gallery] img, [class*=product] img, [class*=menu] img").toArray().map(el => imageEntry(bestImageSrc(attribute => $(el).attr(attribute), url), clean($(el).attr("alt") || ""))).filter(Boolean).slice(0, 6), "product page images", true);
      put(entry.fields.images, [imageEntry(absolute($('meta[property="og:image"]').attr("content"), url), "")].filter(Boolean), "page preview image (og:image)", true);
      put(entry.fields.disclaimers, keptSentences(blocks).filter(sentence => DISCLAIMER.test(sentence)).slice(0, 4), "product page disclaimers");
      put(entry.fields.privacyPolicy, keptSentences(blocks).filter(sentence => /\b(privacy|personal (?:data|information)|we (?:collect|store|share))\b/i.test(sentence)).slice(0, 2).join(" "), "product page privacy statements");
      knowledge.offerings.push(entry);
    }
  }
  // Contact details, platform signals, meta keywords, and products embedded in page scripts.
  put(f.phones, normalizePhones(page.signals.phones).slice(0, 5), "tel: links and page text");
  put(f.emails, normalizeEmails(page.signals.emails).slice(0, 5), "mailto: links and page text");
  put(f.platforms, page.signals.platforms, "scripts, stylesheets, and generator meta", true);
  put(f.siteLanguage, page.meta.lang || "", "html lang attribute");
  put(insights.topics, (page.meta.keywords || "").split(",").map(clean).filter(Boolean).slice(0, 10), "meta keywords", true);
  for (const product of page.signals.products) {
    if (knowledge.offerings.length >= 60 || knowledge.offerings.some(entry => fieldText(entry.fields.name).toLowerCase() === product.name.toLowerCase())) continue;
    const entry: Entry = { id: crypto.randomUUID(), fields: emptyGroup(offeringFields) };
    put(entry.fields.name, product.name, "embedded JavaScript data", true);
    put(entry.fields.type, "Product", "embedded JavaScript data", true);
    put(entry.fields.pricing, product.price, "embedded JavaScript data", true);
    knowledge.offerings.push(entry);
  }
  // Menus, catalogs, and galleries often list items as image cards rather than detail pages.
  if (/\/(?:menu|menus|shop|store|products?|catalog|collections?|gallery|specials)(?:\/|$)/i.test(path)) {
    const cardType = /menu/i.test(path) ? "Menu item" : /gallery/i.test(path) ? "Gallery item" : /shop|store|products?|catalog|collections?/i.test(path) ? "Product" : "Service";
    const seenNames = new Set(knowledge.offerings.map(entry => fieldText(entry.fields.name).toLowerCase()));
    $("li, article, div, section, figure").each((_index, el) => {
      if (knowledge.offerings.length >= 60) return false;
      const card = $(el);
      const headings = card.find("h2,h3,h4,h5");
      const nameEl = headings.length === 1 ? headings.first() : card.find("[class*=title],[class*=name],strong").first();
      if (headings.length > 1 || !nameEl.length || card.find("img").length === 0) return;
      const name = clean(nameEl.text());
      const image = card.find("img").first();
      const src = bestImageSrc(attribute => image.attr(attribute), url);
      if (name.length < 2 || name.length > 80 || !src || seenNames.has(name.toLowerCase())) return;
      const copy = card.clone(); copy.find("h2,h3,h4,img,button,a").remove();
      const entry: Entry = { id: crypto.randomUUID(), fields: emptyGroup(offeringFields) };
      put(entry.fields.name, name, "menu or catalog card heading", true);
      put(entry.fields.type, cardType, "card page URL path", true);
      put(entry.fields.description, clean(copy.text()).slice(0, 400), "card description", true);
      put(entry.fields.pricing, card.text().match(/[$£€]\s?\d[\d,.]*/)?.[0] || "", "price on card", true);
      put(entry.fields.images, [imageEntry(src, clean(image.attr("alt") || ""))], "card image", true);
      put(entry.fields.disclaimers, pageSentences.filter(sentence => DISCLAIMER.test(sentence) || FOOD_NOTICE.test(sentence)).slice(0, 4), "menu or catalog page notice", true);
      knowledge.offerings.push(entry); seenNames.add(name.toLowerCase());
    });
  }
  const overview = fieldText(f.overview);
  if (!fieldText(f.industry)) {
    const industryRules: [RegExp, string][] = [[/\b(accounting|bookkeeping|tax preparation)\b/i, "Accounting and tax services"], [/\b(law firm|legal services|attorneys)\b/i, "Legal services"], [/\b(dental|dentistry)\b/i, "Dental care"], [/\b(restaurant|dining|catering)\b/i, "Food and hospitality"], [/\b(software|SaaS)\b/i, "Software"]];
    const classification = industryRules.find(([pattern]) => pattern.test(overview));
    if (classification) { put(f.industry, classification[1], "keyword classification from overview", true); f.industry.sources = f.overview.sources.map(source => ({ ...source, locator: "Industry inferred from overview: " + source.locator })); }
  }
  if (knowledge.offerings.length) {
    const kinds = [...new Set(knowledge.offerings.map(entry => fieldText(entry.fields.type)).filter(Boolean))];
    put(f.companyRole, kinds.includes("Service") ? "Service provider" : "Product seller", "offering types", true);
    f.companyRole.sources = knowledge.offerings.flatMap(entry => entry.fields.type.sources).slice(0, 8);
    put(insights.topics, knowledge.offerings.map(entry => fieldText(entry.fields.name)), "topics inferred from offerings", true);
    insights.topics.sources = knowledge.offerings.flatMap(entry => entry.fields.name.sources).slice(0, 15);
  }
}

function collectSocial(href: string, presence: Record<string, Field>, put: (field: Field, value: string[], locator: string) => void) {
  try {
    const url = new URL(href); if (!["https:", "http:"].includes(url.protocol) || /share|intent|\/pin\/|dialog|login/i.test(url.pathname + url.search)) return;
    const host = url.hostname.replace(/^www\./, "");
    const platforms: Record<string, string> = { "linkedin.com": "linkedin", "facebook.com": "facebook", "instagram.com": "instagram", "twitter.com": "x", "x.com": "x", "youtube.com": "youtube", "tiktok.com": "tiktok", "pinterest.com": "other" };
    const key = Object.entries(platforms).find(([domain]) => host === domain || host.endsWith(`.${domain}`))?.[1];
    if (key && url.pathname !== "/") { url.search = ""; url.hash = ""; put(presence[key], [url.href], "social profile link"); }
  } catch { /* Malformed external link. */ }
}
