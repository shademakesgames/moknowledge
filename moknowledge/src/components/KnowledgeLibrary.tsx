"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useKnowledge } from "@/context/KnowledgeProvider";
import { downloadKnowledge, fieldText, logoUrl, knowledgeSchema, populatedCount, recordName, type Knowledge } from "@/lib/knowledge";
import { KnowledgeEditor } from "./KnowledgeEditor";

function CardLogo({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <div className="card-logo"><img src={src} alt={`${name} logo`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /></div>;
}

// The overview is the saved description; it is shown in full for the reader, and clipped by the card and table styles.
const descriptionOf = (record: Knowledge) => fieldText(record.sections.foundation.overview).trim() || "Not provided";

export function KnowledgeLibrary() {
  const { records, ready, save, remove } = useKnowledge();
  const [search, setSearch] = useState(""); const [mode, setMode] = useState<"cards" | "table">("cards");
  const [selectedId, setSelectedId] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(""); const fileRef = useRef<HTMLInputElement>(null);
  const selected = records.find(record => record.id === selectedId);
  const filtered = records.filter(record => [recordName(record), record.requestedUrl, ...Object.values(record.sections.foundation).map(fieldText), ...record.offerings.map(entry => fieldText(entry.fields.name))].join(" ").toLowerCase().includes(search.toLowerCase()));
  function deleteRecord(record: Knowledge) {
    if (!confirm(`Delete ${recordName(record)} from this browser? Export a copy first if you need to keep it.`)) return;
    try { remove(record.id); if (selectedId === record.id) setSelectedId(null); setNotice("Knowledge base deleted."); setError(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete."); }
  }
  function exportRecord(record: Knowledge) { try { downloadKnowledge(record); } catch { setError("Could not export this record."); } }
  const actions = (record: Knowledge) => <div className="row-actions"><button className="text-button" onClick={() => setSelectedId(record.id)}>Details</button><Link className="text-button" href={`/knowledge?edit=${record.id}`}>Edit</Link><button className="text-button" onClick={() => exportRecord(record)}>Export</button><button className="text-button danger" onClick={() => deleteRecord(record)}>Delete</button></div>;
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("Choose a JSON file smaller than 2 MB.");
      const record = knowledgeSchema.parse(JSON.parse(await file.text()));
      if (records.some(item => item.id === record.id) && !confirm("This record already exists. Replace it with the imported version?")) return;
      save(record); setNotice(`Imported ${recordName(record)}.`); setError(null);
    } catch (caught) { setError(caught instanceof Error && !caught.message.startsWith("[") ? caught.message : "This file is not a valid MoKnowledge v1 export."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }
  return <>
    <div className="page-heading"><div><h1>Knowledge library</h1><p>Your saved company knowledge, kept in this browser.</p></div><Link className="button build-button" href="/knowledge">Build knowledge</Link></div>
    {error && <div className="notice error" role="alert">{error}</div>}{notice && <div className="notice success" role="status">{notice}</div>}
    <div className="library-toolbar"><div className="search-box"><label className="sr-only" htmlFor="search">Search knowledge bases</label><span aria-hidden>⌕</span><input id="search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search company, industry, or service…" /></div><div className="actions"><input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} onChange={event => void importFile(event.target.files?.[0])} /><button className="button secondary toolbar-control" disabled={!ready} onClick={() => fileRef.current?.click()}>Import JSON</button><div className="view-toggle" aria-label="Library view"><button aria-pressed={mode === "cards"} onClick={() => setMode("cards")}>Cards</button><button aria-pressed={mode === "table"} onClick={() => setMode("table")}>Table</button></div></div></div>
    <p className="library-count">{filtered.length} knowledge base{filtered.length !== 1 ? "s" : ""} <span>· Saved in this browser</span></p>
    {!ready ? <p role="status">Loading your library…</p> : filtered.length === 0 ? <div className="empty-library"><h2>{records.length ? "No matching companies" : "No saved knowledge yet"}</h2><p>{records.length ? "Try a different company name, industry, or service." : "Build one from a website or import JSON."}</p>{!records.length && <Link className="button primary" href="/knowledge">Build your first knowledge base →</Link>}</div> : mode === "cards" ? <div className="library-grid">{filtered.map(record => <article className="library-card" key={record.id}>{logoUrl(record) && <CardLogo key={logoUrl(record)} src={logoUrl(record)} name={recordName(record)} />}<button className="card-title" onClick={() => setSelectedId(record.id)}>{recordName(record)}</button><p className="domain">{new URL(record.requestedUrl).hostname}</p><p className="card-description">{descriptionOf(record)}</p><dl className="card-facts"><div><dt>Fields</dt><dd>{populatedCount(record)}</dd></div></dl>{actions(record)}</article>)}</div> : <div className="table-wrap"><table><thead><tr><th>Company</th><th>Description</th><th>Fields</th><th>Actions</th></tr></thead><tbody>{filtered.map(record => <tr key={record.id}><td><strong>{recordName(record)}</strong><small>{new URL(record.requestedUrl).hostname}</small></td><td className="table-description">{descriptionOf(record)}</td><td>{populatedCount(record)}</td><td>{actions(record)}</td></tr>)}</tbody></table></div>}
    {selected && <section className="detail-panel"><div className="section-heading"><div><p className="eyebrow">SAVED KNOWLEDGE</p><h2>{recordName(selected)}</h2></div><div className="actions"><Link className="button secondary" href={`/knowledge?edit=${selected.id}`}>Edit knowledge</Link><button className="button secondary" onClick={() => setSelectedId(null)}>Close details</button></div></div><KnowledgeEditor record={selected} readOnly /></section>}
  </>;
}
