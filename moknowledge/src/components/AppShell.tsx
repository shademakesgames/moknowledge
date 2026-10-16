"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useKnowledge } from "@/context/KnowledgeProvider";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname(); const { records, storageError, reset } = useKnowledge();
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/knowledge" className="brand">Knowledge</Link>
      <nav aria-label="Main navigation">
        <Link className={path === "/knowledge" ? "nav-link active" : "nav-link"} href="/knowledge"><span aria-hidden>✧</span> Knowledge builder</Link>
        <Link className={path === "/knowledge/view" ? "nav-link active" : "nav-link"} href="/knowledge/view"><span aria-hidden>▦</span> Knowledge library <span className="nav-count">{records.length}</span></Link>
      </nav>
    </aside>
    <div className="app-main">
      <main className="main-content">
        {storageError && <div className="notice error" role="alert">{storageError} <button className="text-button" onClick={() => { if (confirm("Delete this browser’s saved knowledge data? This cannot be undone.")) { try { reset(); } catch { alert("Browser storage is still unavailable."); } } }}>Reset local library</button></div>}
        {children}
      </main>
    </div>
  </div>;
}
