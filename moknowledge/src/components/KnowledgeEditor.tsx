"use client";
import { useState } from "react";
import { ExpandedDocument } from "./ExpandedDocument";
import { categories, competitorFields, emptyGroup, fieldText, offeringFields, personFields, type Entry, type Field, type FieldDefinition, type Knowledge } from "@/lib/knowledge";

type EntityTab = "people" | "offerings" | "competitors";

function ImageStrip({ value }: { value: string }) {
  const items = value.split("\n").map(line => line.trim().match(/^(https?:\/\/\S+)(?:\s+—\s+(.*))?$/)).filter((match): match is RegExpMatchArray => match !== null).map(match => ({ src: match[1], caption: match[2] || "" }));
  if (!items.length) return null;
  return <div className="image-strip">{items.map((item, index) => <figure key={`${item.src}-${index}`}><img src={item.src} alt={item.caption || "Product image"} loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.parentElement!.style.display = "none"; }} /><figcaption>{item.caption || "No caption"}</figcaption></figure>)}</div>;
}

function FieldInput({ definition, field, onChange, readOnly }: { definition: FieldDefinition; field: Field; onChange: (field: Field) => void; readOnly?: boolean }) {
  const text = fieldText(field);
  return <div className="field-card">
    <div className="field-heading"><label htmlFor={`field-${definition.key}`}>{definition.label}</label><span className={`status ${field.status}`}>{field.reviewed ? "Reviewed" : field.status === "user_provided" ? "Your edit" : field.status === "unknown" ? "Not found" : field.status === "inferred" ? "Needs review" : "From website"}</span></div>
    {readOnly ? <p className={`field-value ${!text ? "muted" : ""}`}>{text || "Not provided"}</p> : <textarea id={`field-${definition.key}`} rows={definition.list || text.length > 120 ? 4 : 2} value={text} placeholder={definition.list ? "Add one item per line…" : "Add what you know…"} onChange={event => {
      const value = definition.list ? event.target.value.split("\n") : event.target.value;
      onChange({ ...field, originalValue: field.originalValue !== undefined ? field.originalValue : field.value, value, status: "user_provided", reviewed: false });
    }} />}
    {definition.list && !readOnly && <span className="field-hint">{definition.kind === "images" ? "One image per line: URL — what it shows" : "One item per line"}</span>}
    {definition.kind === "images" && <ImageStrip value={text} />}
    {definition.kind === "logo" && /^https?:\/\//i.test(text.trim()) && <div className="logo-preview"><img src={text.trim()} alt="Logo preview" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.parentElement!.style.display = "none"; }} /></div>}
    <div className="field-bottom">
      {field.sources.length > 0 ? <details className="evidence"><summary>{field.sources.length} source{field.sources.length !== 1 ? "s" : ""}{field.status === "user_provided" ? " for original extraction" : ""}</summary><div className="evidence-content">
        {field.originalValue !== undefined && <p><strong>Original value:</strong> {Array.isArray(field.originalValue) ? field.originalValue.join("; ") : field.originalValue || "Not found"}</p>}
        {field.sources.map((source, index) => <div key={`${source.url}-${index}`}><a href={source.url} target="_blank" rel="noopener noreferrer">{new URL(source.url).hostname}{new URL(source.url).pathname}</a><p>{source.excerpt}</p><small>{source.locator} · {new Date(source.retrievedAt).toLocaleDateString()}</small></div>)}
      </div></details> : <span className="field-hint">{field.status === "user_provided" ? "Provided by you" : "No supporting source found"}</span>}
      {!readOnly && text.trim() && <button type="button" className="text-button" onClick={() => onChange({ ...field, reviewed: !field.reviewed })}>{field.reviewed ? "Undo review" : "Mark reviewed"}</button>}
    </div>
  </div>;
}
export function KnowledgeEditor({ record, onChange, readOnly = false }: { record: Knowledge; onChange?: (record: Knowledge) => void; readOnly?: boolean }) {
  const [tab, setTab] = useState("foundation"); const [onlyPopulated, setOnlyPopulated] = useState(false); const [view, setView] = useState<"fields" | "expanded">("fields");
  const entityMode = tab === "people" || tab === "offerings" || tab === "competitors";
  const group = categories.find(category => category.id === tab);
  const definitions = tab === "people" ? personFields : tab === "competitors" ? competitorFields : offeringFields;
  const entries = entityMode ? record[tab as EntityTab] : [];
  function updateSection(key: string, field: Field) { onChange?.({ ...record, sections: { ...record.sections, [tab]: { ...record.sections[tab], [key]: field } } }); }
  function updateEntry(id: string, key: string, field: Field) { const entityKey = tab as EntityTab; onChange?.({ ...record, [tab]: record[entityKey].map(entry => entry.id === id ? { ...entry, fields: { ...entry.fields, [key]: field } } : entry) }); }
  function addEntry() { const entry: Entry = { id: crypto.randomUUID(), fields: emptyGroup(definitions) }; onChange?.({ ...record, [tab]: [...entries, entry] }); }
  const tabs = [...categories.map(category => ({ id: category.id, label: category.label, count: Object.values(record.sections[category.id]).filter(field => fieldText(field)).length })), { id: "people", label: "Key people", count: record.people.length }, { id: "offerings", label: "Products & services", count: record.offerings.length }, { id: "competitors", label: "Competitors", count: record.competitors.length }];
  return <>
    <div className="editor-toolbar"><div className="view-toggle" role="group" aria-label="Knowledge view"><button type="button" aria-pressed={view === "fields"} onClick={() => setView("fields")}>Fields</button><button type="button" aria-pressed={view === "expanded"} onClick={() => setView("expanded")}>Expanded</button></div></div>
    {view === "expanded" ? <ExpandedDocument record={record} /> : <div className="editor-layout"><nav className="category-nav" aria-label="Knowledge categories">{tabs.map(item => <button type="button" key={item.id} aria-current={tab === item.id ? "true" : undefined} className={tab === item.id ? "selected" : ""} onClick={() => setTab(item.id)}>{item.label}<span>{item.count}</span></button>)}</nav>
    <section className="editor-content" aria-label={group?.label || tab}>
      <div className="section-heading"><div><h2>{group?.label || tabs.find(item => item.id === tab)?.label}</h2><p>{group?.description || (tab === "competitors" ? "Companies that offer similar services, with their websites." : "Review extracted entries or add the details your website doesn’t include.")}</p></div>{!entityMode && <label className="toggle-label"><input type="checkbox" checked={onlyPopulated} onChange={event => setOnlyPopulated(event.target.checked)} /> Hide empty</label>}</div>
      {!entityMode && group && <div className="field-grid">{group.fields.filter(def => !onlyPopulated || fieldText(record.sections[tab][def.key])).map(def => <FieldInput key={def.key} definition={def} field={record.sections[tab][def.key]} onChange={field => updateSection(def.key, field)} readOnly={readOnly} />)}</div>}
      {entityMode && <div className="entity-list">{entries.length === 0 && <div className="empty-inline"><h3>{tab === "people" ? "No people found yet" : tab === "competitors" ? "No competitors added yet" : "No offerings found yet"}</h3><p>Some websites don’t publish these details in readable HTML. You can add them here.</p></div>}{entries.map((entry, index) => <div className="entity-card" key={entry.id}><div className="section-heading"><h3>{fieldText(entry.fields.name) || `New entry ${index + 1}`}</h3>{!readOnly && <button type="button" className="text-button danger" onClick={() => { if (confirm("Remove this entry from the draft?")) onChange?.({ ...record, [tab]: entries.filter(item => item.id !== entry.id) }); }}>Remove</button>}</div><div className="field-grid">{definitions.map(def => <FieldInput key={def.key} definition={{ ...def, key: `${entry.id}-${def.key}` }} field={entry.fields[def.key]} onChange={field => updateEntry(entry.id, def.key, field)} readOnly={readOnly} />)}</div></div>)}{!readOnly && <button type="button" className="button secondary" onClick={addEntry}>＋ Add {tab === "people" ? "person" : tab === "competitors" ? "competitor" : "offering"}</button>}</div>}
    </section>
  </div>}
  </>;
}
