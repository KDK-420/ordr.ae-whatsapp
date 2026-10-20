import type { Metadata } from "next";
import { Checkout } from "@/components/checkout";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function PayPage({ params }: { params: Promise<{ intent: string }> }) {
  const { intent } = await params;
  return <Checkout intent={intent} />;
}
