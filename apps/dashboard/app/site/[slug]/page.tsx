import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { type PublicSite, SitePage } from "@/components/site/site-page";

export const dynamic = "force-dynamic";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:3000";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> };

async function load(slug: string, lang: string | undefined): Promise<PublicSite | null> {
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : "";
  const res = await fetch(`${API_INTERNAL_URL}/v1/sites/${encodeURIComponent(slug)}${query}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`site ${slug}: API answered ${res.status}`);
  return (await res.json()) as PublicSite;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, { lang }] = await Promise.all([params, searchParams]);
  const site = await load(slug, lang);
  if (!site) return { title: "Not found" };
  const description = site.about?.slice(0, 160) ?? site.headline;
  return {
    title: { absolute: site.name },
    description,
    openGraph: { title: site.name, description, images: site.heroImageUrl ? [site.heroImageUrl] : undefined },
  };
}

/** A customer's public page; the proxy serves it at the root of <slug>.ordr.ae. */
export default async function CustomerSite({ params, searchParams }: Props) {
  const [{ slug }, { lang }] = await Promise.all([params, searchParams]);
  const site = await load(slug, lang);
  if (!site) notFound();
  return <SitePage site={site} />;
}
