import { Suspense } from "react";
import { KnowledgeBuilder } from "@/components/KnowledgeBuilder";
export default function KnowledgePage() { return <Suspense fallback={<p>Loading knowledge builder…</p>}><KnowledgeBuilder /></Suspense>; }
