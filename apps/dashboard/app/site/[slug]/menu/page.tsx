import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { StoreFrame } from "@/components/store/chrome";
import { StoreMenu } from "@/components/store/pages";
import { storeBase } from "@/lib/hosts";
import { loadStore } from "@/lib/store-server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const store = await loadStore((await params).slug);
  return store ? { title: { absolute: `Menu | ${store.name}` }, description: `Order from ${store.name}: ${store.categories.map((c) => c.name).join(", ")}.` } : { title: "Not found" };
}

/** The restaurant's menu, served at <host>/menu. */
export default async function MenuPage({ params, searchParams }: Props) {
  const [{ slug }, { lang }] = await Promise.all([params, searchParams]);
  const store = await loadStore(slug, lang);
  if (!store) notFound();
  return (
    <StoreFrame store={store} base={storeBase((await headers()).get("host") ?? "", slug)}>
      <StoreMenu />
    </StoreFrame>
  );
}
