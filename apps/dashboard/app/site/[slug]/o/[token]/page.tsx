import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { StoreFrame } from "@/components/store/chrome";
import { StoreTrack } from "@/components/store/pages";
import { storeBase } from "@/lib/hosts";
import { loadStore, loadTrackedOrder } from "@/lib/store-server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "Your order" }, robots: { index: false } };

/** One order, for the customer who placed it: served at <host>/o/<token>. The token is the only key. */
export default async function TrackPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const [store, order] = await Promise.all([loadStore(slug), loadTrackedOrder(slug, token)]);
  if (!store || !order) notFound();
  return (
    <StoreFrame store={store} base={storeBase((await headers()).get("host") ?? "", slug)} plain>
      <StoreTrack token={token} initial={order} />
    </StoreFrame>
  );
}
