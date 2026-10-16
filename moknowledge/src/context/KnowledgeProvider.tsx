"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import { knowledgeSchema, type Knowledge } from "@/lib/knowledge";

const STORAGE_KEY = "moknowledge.records.v1";
type Store = { records: Knowledge[]; ready: boolean; storageError: string | null; save: (record: Knowledge) => Knowledge; remove: (id: string) => void; reset: () => void };
const Context = createContext<Store | null>(null);
export function KnowledgeProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<Knowledge[]>([]);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  useEffect(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) setRecords(z.array(knowledgeSchema).parse(JSON.parse(raw))); }
    catch { setStorageError("Saved data could not be read. It has not been overwritten. Download any needed data before resetting this browser’s library."); }
    finally { setReady(true); }
  }, []);
  function persist(next: Knowledge[]) {
    if (!ready || storageError) throw new Error("Local storage is unavailable. You can still download your draft as JSON.");
    const validated = z.array(knowledgeSchema).parse(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(validated)); }
    catch { throw new Error("Could not save in this browser. Storage may be full or disabled. Download JSON to keep your work."); }
    setRecords(validated);
  }
  function save(record: Knowledge) {
    const existing = records.find(item => item.id === record.id);
    const saved = knowledgeSchema.parse({ ...record, version: existing ? existing.version + 1 : record.version, updatedAt: new Date().toISOString() });
    persist([saved, ...records.filter(item => item.id !== saved.id)]); return saved;
  }
  function remove(id: string) { persist(records.filter(item => item.id !== id)); }
  function reset() { localStorage.removeItem(STORAGE_KEY); setRecords([]); setStorageError(null); }
  return <Context.Provider value={{ records, ready, storageError, save, remove, reset }}>{children}</Context.Provider>;
}
export function useKnowledge() { const store = useContext(Context); if (!store) throw new Error("Knowledge provider is missing."); return store; }
