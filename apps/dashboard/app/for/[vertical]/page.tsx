import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChatDemo } from "@/components/marketing/chat-demo";
import { CallToAction, contactLinks, Faq, SiteFooter, SiteNav } from "@/components/marketing/site";
import { FAQ, VERTICALS, verticalBySlug } from "@/lib/marketing";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ vertical: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const v = verticalBySlug((await params).vertical);
  if (!v) return {};
  return { title: `${v.name} · ordr.ae`, description: v.sub };
}

export default async function VerticalPage({ params }: Params) {
  const v = verticalBySlug((await params).vertical);
  if (!v) notFound();
  const { bookDemo } = contactLinks();
  return (
    <main className="bg-white">
      <SiteNav />
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-14 md:grid-cols-[1.15fr_1fr] md:pb-24 md:pt-20">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">
            {v.name}
            {v.status === "soon" ? " · coming soon" : ""}
          </p>
          <h1 className="mt-3 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">{v.headline}</h1>
          <p className="mt-6 max-w-xl text-lg text-slate-600">{v.sub}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={bookDemo} className="rounded-md bg-brand px-5 py-3 text-sm font-semibold text-white hover:bg-brand-dark">
              {v.status === "live" ? "Book a demo" : "Join the waitlist"}
            </a>
            <Link href="/" className="rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-semibold hover:border-slate-400">
              All industries
            </Link>
          </div>
        </div>
        <ChatDemo lines={v.conversation} title={v.slug === "salons" ? "Glow Salon" : v.slug === "restaurants" ? "Bella Pasta" : v.slug === "clinics" ? "Smile Clinic" : v.slug === "resorts" ? "Al Noor Resorts" : "Marina Padel"} />
      </section>

      <section className="bg-slate-50">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">What the AI handles for you</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {v.handles.map((h) => (
              <li key={h} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
                <span className="mt-0.5 text-brand">✓</span>
                <span>{h}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-slate-500">Everything else, it hands over to your team with the conversation attached.</p>
        </div>
      </section>

      <Faq items={[...v.faq, ...FAQ.slice(0, 4)]} />
      <CallToAction title={v.status === "live" ? `See it answer your ${v.name.toLowerCase()} customers.` : `Be first when ${v.name.toLowerCase()} go live.`} />
      <section className="mx-auto max-w-6xl px-5 pb-12 text-sm text-slate-500">
        Other industries:{" "}
        {VERTICALS.filter((o) => o.slug !== v.slug).map((o, i) => (
          <span key={o.slug}>
            {i > 0 ? " · " : ""}
            <Link href={`/for/${o.slug}`} className="underline hover:text-slate-800">
              {o.name}
            </Link>
          </span>
        ))}
      </section>
      <SiteFooter />
    </main>
  );
}
