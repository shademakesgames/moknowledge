import { z } from "zod";

export type FieldDefinition = { key: string; label: string; list?: boolean; kind?: "logo" | "images" };
export const categories = [
  { id: "foundation", label: "Company foundation", description: "Who you are, where you work, and what you do.", fields: [
    { key: "name", label: "Company name" }, { key: "overview", label: "Overview" },
    { key: "website", label: "Website" }, { key: "logo", label: "Logo", kind: "logo" }, { key: "industry", label: "Industry" },
    { key: "businessModel", label: "Business model" }, { key: "companyRole", label: "Company role" },
    { key: "yearFounded", label: "Year founded" }, { key: "legalEntityType", label: "Legal entity type" },
    { key: "employeeCount", label: "Employee count" }, { key: "mainAddress", label: "Main address" }, { key: "phones", label: "Phone numbers", list: true }, { key: "emails", label: "Email addresses", list: true }, { key: "platforms", label: "Website & tech platforms", list: true }, { key: "siteLanguage", label: "Site language" },
    { key: "otherLocations", label: "Other locations", list: true }, { key: "serviceLocations", label: "Service locations", list: true },
    { key: "alternativeNames", label: "Alternative names", list: true },
  ] },
  { id: "positioning", label: "Positioning", description: "Your story and the reasons customers choose you.", fields: [
    { key: "pitch", label: "Company pitch" }, { key: "foundingStory", label: "Founding story" },
    { key: "differentiators", label: "Differentiators", list: true },
  ] },
  { id: "market", label: "Market & customers", description: "The people you serve and how they find you.", fields: [
    { key: "targetBuyers", label: "Target buyers", list: true }, { key: "customerNeeds", label: "Customer needs", list: true },
    { key: "idealPersona", label: "Ideal customer persona" }, { key: "industryGroupings", label: "Industry groupings", list: true },
    { key: "industryOutlook", label: "Industry outlook" }, { key: "channels", label: "Channels", list: true },
    { key: "funnels", label: "Funnels", list: true }, { key: "ctas", label: "Calls to action", list: true },
    { key: "partners", label: "Suppliers / partners", list: true },
  ] },
  { id: "branding", label: "Branding & style", description: "Language and visual signals found on your website.", fields: [
    { key: "writingStyle", label: "Writing style" }, { key: "artStyle", label: "Art style" },
    { key: "fonts", label: "Font candidates", list: true }, { key: "colors", label: "Color candidates (hex)", list: true },
    { key: "logos", label: "Logo candidates", list: true },
  ] },
  { id: "presence", label: "Online presence", description: "Your company’s public social profiles.", fields: [
    { key: "linkedin", label: "LinkedIn", list: true }, { key: "facebook", label: "Facebook", list: true },
    { key: "instagram", label: "Instagram", list: true }, { key: "x", label: "X / Twitter", list: true },
    { key: "youtube", label: "YouTube", list: true }, { key: "tiktok", label: "TikTok", list: true },
    { key: "other", label: "Other profiles", list: true },
  ] },
  { id: "insights", label: "Content & trust", description: "Evidence that makes future posts, emails, and articles useful.", fields: [
    { key: "faqs", label: "Questions & answers", list: true }, { key: "testimonials", label: "Testimonials & attribution", list: true },
    { key: "certifications", label: "Certifications / awards", list: true }, { key: "topics", label: "Content themes", list: true },
    { key: "claims", label: "Disclaimers & claim restrictions", list: true }, { key: "promotions", label: "Dated promotions", list: true },
  ] },
  { id: "legal", label: "Legal & compliance", description: "Privacy policy, terms, licensing, and regulatory signals from your website. Product-specific privacy and disclaimers are on each product.", fields: [
    { key: "privacyPolicyUrl", label: "Privacy policy URL" }, { key: "termsUrl", label: "Terms of service URL" },
    { key: "licenses", label: "Licenses & registrations", list: true }, { key: "compliance", label: "Compliance frameworks", list: true },
    { key: "regulatoryNotes", label: "Regulatory & advice notices", list: true },
    { key: "dataPractices", label: "Data & privacy practices", list: true },
  ] },
] satisfies { id: string; label: string; description: string; fields: FieldDefinition[] }[];

export const personFields: FieldDefinition[] = [
  { key: "name", label: "Name" }, { key: "title", label: "Title" }, { key: "role", label: "Role" },
  { key: "gender", label: "Gender (only if explicitly stated)" }, { key: "background", label: "Background" },
];
export const offeringFields: FieldDefinition[] = [
  { key: "name", label: "Name" }, { key: "type", label: "Product / service" }, { key: "category", label: "Category" },
  { key: "description", label: "Description" }, { key: "features", label: "Features", list: true }, { key: "pricing", label: "Pricing & qualifiers" },
  { key: "images", label: "Images", list: true, kind: "images" }, { key: "privacyPolicy", label: "Privacy policy (this product)" }, { key: "disclaimers", label: "Product disclaimers", list: true },
];

export const competitorFields: FieldDefinition[] = [
  { key: "name", label: "Company" }, { key: "website", label: "Website" },
];

const httpUrl = z.string().url().refine(value => /^https?:\/\//i.test(value), "Use HTTP or HTTPS URLs");
export const evidenceSchema = z.object({ url: httpUrl, excerpt: z.string().max(3000), locator: z.string(), retrievedAt: z.string().datetime() });
export const fieldSchema = z.object({
  value: z.union([z.string().max(20000), z.array(z.string().max(10000)).max(100), z.null()]),
  status: z.enum(["extracted", "inferred", "user_provided", "unknown"]),
  sources: z.array(evidenceSchema).max(100),
  reviewed: z.boolean(),
  originalValue: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
});
const groupSchema = (fields: FieldDefinition[]) => z.object(Object.fromEntries(fields.map(field => [field.key, fieldSchema.default(() => ({ value: null, status: "unknown" as const, sources: [], reviewed: false }))])));
const sectionShape = Object.fromEntries(categories.map(category => [category.id, groupSchema(category.fields).prefault(() => ({}))]));
export const knowledgeSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().uuid(), version: z.number().int().positive(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  requestedUrl: httpUrl,
  sections: z.object(sectionShape),
  people: z.array(z.object({ id: z.string().uuid(), fields: groupSchema(personFields) })).max(100),
  offerings: z.array(z.object({ id: z.string().uuid(), fields: groupSchema(offeringFields) })).max(100),
  competitors: z.array(z.object({ id: z.string().uuid(), fields: groupSchema(competitorFields) })).max(100).default([]),
  crawl: z.object({
    pages: z.array(z.object({ url: httpUrl, title: z.string(), status: z.enum(["success", "failed", "skipped"]), message: z.string().optional(), meta: z.record(z.string(), z.string()).default({}), headings: z.array(z.string().max(300)).max(60).default([]), content: z.string().max(12000).default("") })).max(100),
    warnings: z.array(z.string()).max(100), completedAt: z.string().datetime(),
  }),
});
export type Knowledge = z.infer<typeof knowledgeSchema>;
export type Field = z.infer<typeof fieldSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Entry = Knowledge["people"][number];
export const emptyField = (): Field => ({ value: null, status: "unknown", sources: [], reviewed: false });
export const emptyGroup = (fields: FieldDefinition[]): Record<string, Field> => Object.fromEntries(fields.map(field => [field.key, emptyField()]));
export function newKnowledge(url: string): Knowledge {
  const now = new Date().toISOString();
  return { schemaVersion: 1, id: crypto.randomUUID(), version: 1, createdAt: now, updatedAt: now, requestedUrl: url,
    sections: Object.fromEntries(categories.map(category => [category.id, emptyGroup(category.fields)])), people: [], offerings: [], competitors: [],
    crawl: { pages: [], warnings: [], completedAt: now } };
}
export function fieldText(field?: Field): string { return Array.isArray(field?.value) ? field.value.join("\n") : field?.value ?? ""; }
export function recordName(record: Knowledge): string { return fieldText(record.sections.foundation.name) || new URL(record.requestedUrl).hostname; }
export function allFields(record: Knowledge): Field[] { return [...Object.values(record.sections).flatMap(Object.values), ...record.people.flatMap(entry => Object.values(entry.fields)), ...record.offerings.flatMap(entry => Object.values(entry.fields)), ...record.competitors.flatMap(entry => Object.values(entry.fields))]; }
export function logoUrl(record: Knowledge): string {
  const value = fieldText(record.sections.foundation.logo).trim();
  return /^https?:\/\//i.test(value) ? value : "";
}
export function populatedCount(record: Knowledge): number { return allFields(record).filter(field => fieldText(field).trim()).length; }
export function downloadKnowledge(record: Knowledge) {
  const parsed = knowledgeSchema.parse(record);
  const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(parsed, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = objectUrl;
  a.download = `${recordName(record).toLowerCase().replace(/[^a-z0-9]+/g, "-") || "knowledge"}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
