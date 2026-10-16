"use client";
import { recordName, type Knowledge } from "@/lib/knowledge";
import { documentSections, type DocumentField } from "@/lib/document";

function FieldBlock({ field, heading: Heading }: { field: DocumentField; heading: "h3" | "h4" }) {
  return <div className="doc-field">
    <Heading>{field.label}</Heading>
    {field.list ? <ul>{field.lines.map((line, index) => <li key={index}>{line}</li>)}</ul> : field.lines.map((line, index) => <p key={index}>{line}</p>)}
  </div>;
}

export function ExpandedDocument({ record }: { record: Knowledge }) {
  const sections = documentSections(record);
  const title = recordName(record);
  return <article className="expanded-doc" aria-label={`${title} document`}>
    <h1>{title}</h1>
    <p className="doc-source">{new URL(record.requestedUrl).hostname}</p>
    {sections.map(section => <section key={section.title}>
      <h2>{section.title}</h2>
      {section.description && <p className="doc-intro">{section.description}</p>}
      {section.fields.map(field => <FieldBlock key={field.label} field={field} heading="h3" />)}
      {section.entries.map((entry, index) => <div className="doc-entry" key={`${entry.title}-${index}`}>
        <h3>{entry.title}</h3>
        {entry.fields.map(field => <FieldBlock key={field.label} field={field} heading="h4" />)}
      </div>)}
    </section>)}
    {sections.length === 0 && <p className="doc-intro">Nothing has been added to this knowledge base yet.</p>}
  </article>;
}
