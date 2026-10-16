import Link from "next/link";

// Read WHATSAPP_NUMBER at request time so the deployed container can set it without a rebuild.
export const dynamic = "force-dynamic";

const FEATURES = [
  { title: "Orders on WhatsApp", body: "Customers browse the menu, build a cart and check out without installing anything." },
  { title: "Arabic and English", body: "Every message and menu item is bilingual. The bot follows the language the customer writes in." },
  { title: "Live order board", body: "Accept, prepare and hand over orders from one screen. Customers get a WhatsApp update at each step." },
];

export default function LandingPage() {
  const number = (process.env.WHATSAPP_NUMBER ?? "").replace(/[^0-9]/g, "");
  const waLink = number ? `https://wa.me/${number}?text=${encodeURIComponent("hi")}` : null;
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <span className="text-xl font-semibold tracking-tight">
          ordr<span className="text-brand">.ae</span>
        </span>
        <Link href="/login" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:border-slate-400">
          Merchant sign in
        </Link>
      </header>

      <section className="flex flex-1 flex-col justify-center py-20">
        <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Take orders where your customers already are: WhatsApp.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-slate-600">
          ordr.ae turns your WhatsApp number into a menu, a checkout and an order desk. Built for restaurants, cafes and
          cloud kitchens in the UAE.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {waLink ? (
            <a href={waLink} className="rounded-md bg-brand px-5 py-3 text-sm font-semibold text-white hover:bg-brand-dark">
              Try the demo on WhatsApp
            </a>
          ) : null}
          <Link href="/login" className="rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-semibold hover:border-slate-400">
            Open the dashboard
          </Link>
        </div>
      </section>

      <section className="grid gap-6 border-t border-slate-200 py-12 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title}>
            <h2 className="font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm text-slate-600">{f.body}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-slate-200 py-6 text-xs text-slate-500">ordr.ae · Dubai, UAE</footer>
    </main>
  );
}
