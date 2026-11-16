import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { StoreFrame } from "@/components/store/chrome";
import { StoreCheckout } from "@/components/store/pages";
import { storeBase } from "@/lib/hosts";
import { loadStore } from "@/lib/store-server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "Checkout" }, robots: { index: false } };

/** Checkout, served at <host>/checkout. */
export default async function CheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await loadStore(slug);
  if (!store) notFound();
  return (
    <StoreFrame store={store} base={storeBase((await headers()).get("host") ?? "", slug)} plain>
      <StoreCheckout />
    </StoreFrame>
  );
}
