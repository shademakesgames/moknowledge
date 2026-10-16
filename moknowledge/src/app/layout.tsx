import type { Metadata } from "next";
import { KnowledgeProvider } from "@/context/KnowledgeProvider";
import { AppShell } from "@/components/AppShell";
import "./globals.css";
export const metadata: Metadata = { title: "MoKnowledge · Your business, understood", description: "Build, review, and manage source-backed company knowledge from your website." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><KnowledgeProvider><AppShell>{children}</AppShell></KnowledgeProvider></body></html>;
}
