import { categories, competitorFields, fieldText, offeringFields, personFields, type Entry, type Field, type FieldDefinition, type Knowledge } from "./knowledge";

export type DocumentField = { label: string; lines: string[]; list: boolean };
export type DocumentEntry = { title: string; fields: DocumentField[] };
export type DocumentSection = { title: string; description: string; fields: DocumentField[]; entries: DocumentEntry[] };

// Only populated values appear in the document. Empty fields, empty sections, and review status are left out entirely.
function toField(definition: FieldDefinition, field?: Field): DocumentField | null {
  const lines = fieldText(field).split("\n").map(line => line.trim()).filter(Boolean);
  return lines.length ? { label: definition.label, lines, list: Boolean(definition.list) } : null;
}

function toEntries(entries: Entry[], definitions: FieldDefinition[]): DocumentEntry[] {
  return entries.flatMap(entry => {
    const fields = definitions.filter(definition => definition.key !== "name").map(definition => toField(definition, entry.fields[definition.key])).filter((field): field is DocumentField => field !== null);
    const title = fieldText(entry.fields.name).trim();
    return fields.length || title ? [{ title: title || "Unnamed", fields }] : [];
  });
}

export function documentSections(record: Knowledge): DocumentSection[] {
  const categorySections = categories.map(category => ({
    title: category.label,
    description: category.description,
    fields: category.fields.filter(definition => !(category.id === "foundation" && definition.key === "name"))
      .map(definition => toField(definition, record.sections[category.id][definition.key])).filter((field): field is DocumentField => field !== null),
    entries: [],
  }));
  const entitySections: DocumentSection[] = [
    { title: "Key people", description: "", fields: [], entries: toEntries(record.people, personFields) },
    { title: "Products & services", description: "", fields: [], entries: toEntries(record.offerings, offeringFields) },
    { title: "Competitors", description: "", fields: [], entries: toEntries(record.competitors, competitorFields) },
  ];
  return [...categorySections, ...entitySections].filter(section => section.fields.length || section.entries.length);
}
