import test from "node:test";
import assert from "node:assert/strict";
import { documentSections } from "../src/lib/document";
import { emptyGroup, emptyField, newKnowledge, personFields, type Knowledge } from "../src/lib/knowledge";

function sample(): Knowledge {
  const record = newKnowledge("https://elevationgroupaz.com/");
  record.sections.foundation.name = { value: "Elevation Group", status: "extracted", sources: [], reviewed: false };
  record.sections.foundation.phones = { value: ["(480) 399-9322", "480-482-9260"], status: "extracted", sources: [], reviewed: false };
  record.sections.positioning.pitch = { value: "Luxury homes in Scottsdale.\nTrusted by local families.", status: "user_provided", sources: [], reviewed: true };
  const person = emptyGroup(personFields);
  person.name = { value: "Kelly Jones", status: "extracted", sources: [], reviewed: false };
  person.role = { value: "Founding Partner", status: "inferred", sources: [], reviewed: false };
  record.people.push({ id: crypto.randomUUID(), fields: person });
  return record;
}

test("document keeps populated fields and drops empty ones and empty sections", () => {
  const sections = documentSections(sample());
  const titles = sections.map(section => section.title);
  assert.ok(titles.includes("Company foundation"));
  assert.ok(titles.includes("Positioning"));
  assert.ok(titles.includes("Key people"));
  assert.ok(!titles.includes("Legal & compliance"), "empty categories are omitted");
  assert.ok(!titles.includes("Competitors"), "empty entity lists are omitted");
  const foundation = sections.find(section => section.title === "Company foundation")!;
  assert.deepEqual(foundation.fields.map(field => field.label), ["Phone numbers"], "the company name is the document title, not a field");
  assert.deepEqual(foundation.fields[0].lines, ["(480) 399-9322", "480-482-9260"]);
  const people = sections.find(section => section.title === "Key people")!;
  assert.deepEqual(people.entries.map(entry => entry.title), ["Kelly Jones"]);
  assert.deepEqual(people.entries[0].fields.map(field => field.label), ["Role"], "empty person fields are dropped");
});

test("an empty knowledge base produces no sections", () => {
  assert.equal(emptyField().value, null);
  assert.deepEqual(documentSections(newKnowledge("https://example.com/")), []);
});
