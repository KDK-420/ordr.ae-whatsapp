import Link from "next/link";
import type { ReactNode } from "react";
import { FAQ, FEATURES, STATS, STEPS, VERTICALS } from "@/lib/marketing";

/** Links that depend on the deployment: read at request time so the container can set them. */
export function contactLinks() {
  const digits = (v: string | undefined) => (v ?? "").replace(/[^0-9]/g, "");
  const contact = digits(process.env.CONTACT_WHATSAPP);
  const demo = digits(process.env.WHATSAPP_NUMBER);
  const email = process.env.CONTACT_EMAIL || "hello@ordr.ae";
  return {
    bookDemo: contact ? `https://wa.me/${contact}?text=${encodeURIComponent("Hi, I'd like a demo of ordr.ae for my business")}` : `mailto:${email}?subject=${encodeURIComponent("ordr.ae demo")}`,
    tryDemo: demo ? `https://wa.me/${demo}?text=${encodeURIComponent("hi")}` : null,
    email,
  };
}

export function SiteNav() {
  const { bookDemo } = contactLinks();
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <Link href="/" className="text-xl font-semibold tracking-tight">
          ordr<span className="text-brand">.ae</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-slate-600 md:flex">
          <a href="/#how" className="hover:text-slate-900">
            How it works
          </a>
          <a href="/#industries" className="hover:text-slate-900">
            Industries
          </a>
          <a href="/#features" className="hover:text-slate-900">
            Features
          </a>
          <a href="/#faq" className="hover:text-slate-900">
            FAQ
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="hidden rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 sm:inline">
            Sign in
          </Link>
          <a href={bookDemo} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
            Book a demo
          </a>
        </div>
      </div>
    </header>
  );
}

export function Section({ id, eyebrow, title, intro, children, dark }: { id?: string; eyebrow?: string; title: string; intro?: string; children: ReactNode; dark?: boolean }) {
  return (
    <section id={id} className={dark ? "bg-ink text-white" : ""}>
      <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
        {eyebrow ? <p className={`text-xs font-semibold uppercase tracking-widest ${dark ? "text-green-300" : "text-brand"}`}>{eyebrow}</p> : null}
        <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
        {intro ? <p className={`mt-4 max-w-2xl text-lg ${dark ? "text-slate-300" : "text-slate-600"}`}>{intro}</p> : null}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

export function Stats() {
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 border-y border-slate-200 px-5 py-8 sm:grid-cols-4">
      {STATS.map((s) => (
        <div key={s.label}>
          <div className="text-3xl font-semibold tracking-tight">{s.value}</div>
          <div className="mt-1 text-sm text-slate-500">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

export function HowItWorks() {
  return (
    <Section id="how" eyebrow="How it works" title="Live in two days, no app, no training." intro="We do the setup. Your customers keep using WhatsApp. Your team gets one screen.">
      <ol className="grid gap-8 md:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.n} className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-brand">{s.n}</div>
            <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

export function Industries() {
  return (
    <Section id="industries" eyebrow="Industries" title="Made for businesses that live on bookings and orders." intro="Each vertical has its own flows, vocabulary and dashboard. Pick yours.">
      <div className="grid gap-5 sm:grid-cols-2">
        {VERTICALS.map((v) => (
          <Link key={v.slug} href={`/for/${v.slug}`} className="group rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-brand hover:shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{v.name}</h3>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${v.status === "live" ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"}`}>{v.status === "live" ? "Live" : "Coming soon"}</span>
            </div>
            <p className="mt-2 text-sm text-slate-600">{v.short}</p>
            <p className="mt-4 text-sm font-medium text-brand group-hover:underline">See how it works →</p>
          </Link>
        ))}
      </div>
    </Section>
  );
}

export function Features() {
  return (
    <Section id="features" eyebrow="What you get" title="An AI receptionist that is careful with your business." intro="Natural to talk to, strict about facts, and honest about when a person should step in." dark>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h3 className="font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">{f.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function Faq({ items = FAQ }: { items?: Array<{ q: string; a: string }> }) {
  return (
    <Section id="faq" eyebrow="FAQ" title="Questions owners ask us.">
      <dl className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
        {items.map((f) => (
          <div key={f.q} className="p-6">
            <dt className="font-semibold">{f.q}</dt>
            <dd className="mt-2 text-sm leading-relaxed text-slate-600">{f.a}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export function CallToAction({ title = "See it answer your customers.", body = "Twenty minutes on a call. We set up a test number with your services and you message it from your phone." }: { title?: string; body?: string }) {
  const { bookDemo, tryDemo, email } = contactLinks();
  return (
    <section className="mx-auto max-w-6xl px-5 pb-20">
      <div className="rounded-3xl bg-brand px-6 py-12 text-white sm:px-12">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
        <p className="mt-3 max-w-xl text-green-50">{body}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={bookDemo} className="rounded-md bg-white px-5 py-3 text-sm font-semibold text-brand-dark hover:bg-green-50">
            Book a demo
          </a>
          {tryDemo ? (
            <a href={tryDemo} className="rounded-md border border-white/60 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10">
              Try the demo salon on WhatsApp
            </a>
          ) : null}
        </div>
        <p className="mt-6 text-xs text-green-100">Or write to {email}</p>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-xs text-slate-500">
        <span>
          ordr<span className="text-brand">.ae</span> · AI receptionist for WhatsApp · Dubai, UAE
        </span>
        <nav className="flex gap-4">
          {VERTICALS.map((v) => (
            <Link key={v.slug} href={`/for/${v.slug}`} className="hover:text-slate-800">
              {v.name}
            </Link>
          ))}
          <Link href="/login" className="hover:text-slate-800">
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  );
}
