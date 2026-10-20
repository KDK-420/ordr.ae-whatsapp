import type { Metadata } from "next";
import { WebChat } from "@/components/web-chat";

export const metadata: Metadata = { title: "Chat", robots: { index: false } };

export default async function ChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <WebChat slug={slug} />;
}
