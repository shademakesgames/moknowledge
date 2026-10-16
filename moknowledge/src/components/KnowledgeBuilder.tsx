"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { KnowledgeEditor } from "./KnowledgeEditor";
import { useKnowledge } from "@/context/KnowledgeProvider";
import { downloadKnowledge, knowledgeSchema, recordName, type Knowledge } from "@/lib/knowledge";

export function KnowledgeBuilder() {
  const search = useSearchParams(); const editId = search.get("edit");
  const { records, ready, save } = useKnowledge();
  const [url, setUrl] = useState(""); const [draft, setDraft] = useState<Knowledge | null>(null);
  const [loading, setLoading] = useState(false); const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState("");
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!editId && loadedId) { setDraft(null); setUrl(""); setLoadedId(null); setDirty(false); setMessage(""); setError(null); return; }
    if (!editId || !ready || loadedId === editId) return;
    const record = records.find(item => item.id === editId);
    if (record) { setDraft(structuredClone(record)); setUrl(record.requestedUrl); setDirty(false); setError(null); }
    else setError("This saved knowledge base was not found in this browser.");
    setLoadedId(editId);
  }, [editId, ready, records, loadedId]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const navigate = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const next = new URL(anchor.href, window.location.href);
      if (next.origin === window.location.origin && next.href !== window.location.href && !confirm("Leave this page and discard your unsaved draft?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", handler); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", handler); document.removeEventListener("click", navigate, true); };
  }, [dirty]);
  useEffect(() => () => abortRef.current?.abort(), []);
  async function build(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || (dirty && !confirm("Replace the unsaved draft with a new website crawl?"))) return;
    setError(null); setMessage("");
    try { const parsed = new URL(/^[a-z][a-z\d+.-]*:/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`); if (!["https:", "http:"].includes(parsed.protocol)) throw new Error(); }
    catch { setError("Enter a valid website, such as https://yourcompany.com."); return; }
    const controller = new AbortController(); abortRef.current = controller; setLoading(true);
    try {
      const response = await fetch("/api/scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }), signal: controller.signal });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "The website could not be analyzed.");
      setDraft(knowledgeSchema.parse(body.knowledge)); setDirty(true); setMessage("Your draft is ready. Review the details below before saving.");
    } catch (caught) {
      if (controller.signal.aborted) setMessage("Crawl cancelled. Your previous draft is unchanged.");
      else setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally { setLoading(false); abortRef.current = null; }
  }
  function saveDraft() {
    if (!draft) return;
    try { const saved = save(draft); setDraft(saved); setDirty(false); setMessage(`Saved ${recordName(saved)} · version ${saved.version}.`); setError(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save."); }
  }
  return <div className={draft ? "builder" : "builder builder-empty"}>
    <div className="page-heading"><div><h1>Knowledge</h1><p>Learn how your company lives on the internet.</p></div></div>
    <div className="workflow" aria-label="Workflow"><span className={!draft ? "current" : "done"}><b>1</b> Paste website</span><i /><span className={draft && dirty ? "current" : draft ? "done" : ""}><b>2</b> Edit</span><i /><span className={draft && !dirty ? "current" : ""}><b>3</b> Save or download</span></div>
    <section className="crawl-card" aria-label="Website input">
      <form onSubmit={build}><label htmlFor="website">Company website</label><div className="url-form"><input id="website" name="website" type="text" inputMode="url" required maxLength={2048} placeholder="https://yourcompany.com" value={url} onChange={event => setUrl(event.target.value)} disabled={loading} /><button className="button build-button" disabled={loading || !ready} type="submit">{loading ? <><span className="spinner" /> Exploring website…</> : <>Build knowledge</>}</button></div>{loading && <div className="form-caption"><span>This may take up to 40 seconds.</span><button type="button" className="text-button" onClick={() => abortRef.current?.abort()}>Cancel</button></div>}</form>
    </section>
    {error && <div className="notice error" role="alert">{error}</div>}{message && <div className="notice success" role="status">{message}</div>}
    {draft && <div className={loading ? "draft-block busy" : "draft-block"}>
      <div className="record-heading"><div><h2>{recordName(draft)}</h2><p>{new URL(draft.requestedUrl).hostname}</p></div></div>
      <details className="crawl-report"><summary>Sources & crawl notes <span>{draft.crawl.warnings.length} notes</span></summary><ul>{draft.crawl.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul><div className="source-pages">{draft.crawl.pages.map((page, index) => <div key={`${page.url}-${index}`}><span className={`status ${page.status === "success" ? "extracted" : "inferred"}`}>{page.status}</span><a href={page.url} target="_blank" rel="noopener noreferrer">{page.title || page.url}</a>{page.message && <small>{page.message}</small>}{page.status === "success" && <details className="page-content"><summary>Page content · {page.headings.length} headings · {Object.keys(page.meta).length} meta tags</summary>{page.headings.length > 0 && <ul>{page.headings.slice(0, 15).map((heading, headingIndex) => <li key={headingIndex}>{heading}</li>)}</ul>}<p>{page.content ? page.content.slice(0, 1500) : "No readable text found."}</p>{Object.keys(page.meta).length > 0 && <dl className="meta-list">{Object.entries(page.meta).slice(0, 30).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>}</details>}</div>)}</div></details>
      <KnowledgeEditor record={draft} onChange={record => { setDraft(record); setDirty(true); setMessage(""); }} />
      <div className="save-bar"><div><strong>{dirty ? "Unsaved changes" : "Saved"}</strong><small>Save here or download a JSON copy.</small></div><div className="actions"><button className="button secondary" type="button" onClick={() => { try { downloadKnowledge(draft); setMessage(dirty ? "Current draft downloaded. It still has unsaved changes in this browser." : "JSON downloaded."); } catch { setError("Could not export this record. Check the field values."); } }}>Download JSON</button><button className="button primary" type="button" disabled={!ready || loading || !dirty} onClick={saveDraft}>Save knowledge</button></div></div>
    </div>}
  </div>;
}
