import type { CSSProperties, ReactNode } from "react";

export interface SiteItem {
  id: string;
  name: string;
  description?: string;
  price: string;
  durationMinutes?: number;
  imageUrl?: string;
  propertyId?: string;
  maxGuests?: number;
}

export interface PublicSite {
  slug: string;
  name: string;
  vertical: string;
  language: string;
  headline?: string;
  about?: string;
  heroImageUrl?: string;
  profile: { address?: string; mapsUrl?: string; phone?: string; hours?: string };
  facts: string[];
  whatsapp?: string;
  categories: Array<{ id: string; name: string; items: SiteItem[] }>;
  properties: Array<{ id: string; name: string; description?: string; address?: string; mapsUrl?: string; phone?: string; checkInTime: string; checkOutTime: string; amenities: string[]; imageUrls: string[] }>;
}

type Words = { en: string; ar: string };

/** Each kind of business gets its own colour and its own words; the layout stays the same. */
const VERTICALS: Record<string, { accent: string; soft: string; offer: Words; cta: Words; headline: Words; greeting: Words }> = {
  sports: {
    accent: "#0f766e",
    soft: "#e6f4f1",
    offer: { en: "Courts and prices", ar: "الملاعب والأسعار" },
    cta: { en: "Book a court", ar: "احجز ملعباً" },
    headline: { en: "Book your court in one message.", ar: "احجز ملعبك برسالة واحدة." },
    greeting: { en: "Hi, I'd like to book a court", ar: "مرحباً، أود حجز ملعب" },
  },
  resort: {
    accent: "#9a6b2f",
    soft: "#f6efe4",
    offer: { en: "Our resorts", ar: "منتجعاتنا" },
    cta: { en: "Book your stay", ar: "احجز إقامتك" },
    headline: { en: "Your stay, arranged in one chat.", ar: "إقامتك في محادثة واحدة." },
    greeting: { en: "Hi, I'd like to book a stay", ar: "مرحباً، أود حجز إقامة" },
  },
  salon: {
    accent: "#a8456b",
    soft: "#f8ecf1",
    offer: { en: "Services", ar: "الخدمات" },
    cta: { en: "Book now", ar: "احجز الآن" },
    headline: { en: "Your next appointment is one message away.", ar: "موعدك القادم على بعد رسالة." },
    greeting: { en: "Hi, I'd like to book an appointment", ar: "مرحباً، أود حجز موعد" },
  },
  restaurant: {
    accent: "#b4441c",
    soft: "#fbeee7",
    offer: { en: "Menu", ar: "القائمة" },
    cta: { en: "Order now", ar: "اطلب الآن" },
    headline: { en: "Order in a message, we take it from there.", ar: "اطلب برسالة، والباقي علينا." },
    greeting: { en: "Hi, I'd like to order", ar: "مرحباً، أود الطلب" },
  },
  retail: {
    accent: "#3f4fa3",
    soft: "#eceefa",
    offer: { en: "Products", ar: "المنتجات" },
    cta: { en: "Shop now", ar: "تسوق الآن" },
    headline: { en: "Shop with us in a chat.", ar: "تسوق معنا عبر المحادثة." },
    greeting: { en: "Hi, I'd like to order", ar: "مرحباً، أود الطلب" },
  },
};

const LABELS = {
  chat: { en: "Chat here", ar: "تحدث هنا" },
  visit: { en: "Visit us", ar: "زرنا" },
  hours: { en: "Opening hours", ar: "ساعات العمل" },
  address: { en: "Address", ar: "العنوان" },
  phone: { en: "Phone", ar: "الهاتف" },
  directions: { en: "Get directions", ar: "الاتجاهات" },
  good: { en: "Good to know", ar: "معلومات مفيدة" },
  min: { en: "min", ar: "دقيقة" },
  sleeps: { en: "Sleeps", ar: "يتسع لـ" },
  perNight: { en: "per night", ar: "لليلة" },
  checkIn: { en: "Check-in from", ar: "تسجيل الوصول من" },
  checkOut: { en: "Check-out by", ar: "تسجيل المغادرة حتى" },
  powered: { en: "Bookings by", ar: "الحجوزات عبر" },
} satisfies Record<string, Words>;

export function SitePage({ site }: { site: PublicSite }) {
  const v = VERTICALS[site.vertical] ?? VERTICALS.salon!;
  const ar = site.language === "ar";
  const say = (w: Words) => (ar ? w.ar : w.en);
  const chatHref = `/chat/${site.slug}`;
  const bookHref = site.whatsapp ? `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(say(v.greeting))}` : chatHref;
  const external = site.whatsapp ? { target: "_blank", rel: "noreferrer" } : {};
  const theme = { "--accent": v.accent, "--soft": v.soft } as CSSProperties;
  const hasVisit = !!(site.profile.address || site.profile.hours || site.profile.phone || site.profile.mapsUrl);
  const allItems = site.categories.flatMap((c) => c.items);

  return (
    <div dir={ar ? "rtl" : "ltr"} lang={site.language} style={theme} className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <span className="truncate text-base font-semibold tracking-tight">{site.name}</span>
          <div className="flex shrink-0 items-center gap-3 text-sm">
            <a href={`?lang=${ar ? "en" : "ar"}`} className="text-slate-500 hover:text-slate-900">
              {ar ? "English" : "العربية"}
            </a>
            <a href={bookHref} {...external} className="hidden rounded-full bg-[var(--accent)] px-4 py-1.5 font-semibold text-white hover:opacity-90 sm:inline-block">
              {say(v.cta)}
            </a>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-[var(--soft)]">
        {site.heroImageUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={site.heroImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/35 to-black/10" />
          </>
        ) : null}
        <div className={`relative mx-auto max-w-5xl px-4 ${site.heroImageUrl ? "pb-12 pt-32 text-white sm:pt-48" : "py-16 sm:py-24"}`}>
          <h1 dir="auto" className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight [text-wrap:balance] sm:text-5xl">{site.headline || say(v.headline)}</h1>
          {site.about ? <p dir="auto" className={`mt-4 max-w-xl whitespace-pre-line text-base leading-7 sm:text-lg ${site.heroImageUrl ? "text-white/90" : "text-slate-600"}`}>{site.about}</p> : null}
          <div className="mt-7 flex flex-wrap gap-3">
            <a href={bookHref} {...external} className="rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white hover:opacity-90">
              {say(v.cta)}
            </a>
            {site.whatsapp ? (
              <a href={chatHref} className={`rounded-full border px-6 py-3 text-sm font-semibold ${site.heroImageUrl ? "border-white/60 text-white hover:bg-white/10" : "border-slate-300 hover:border-slate-400"}`}>
                {say(LABELS.chat)}
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-5xl space-y-14 px-4 py-12">
        {site.vertical === "resort" && site.properties.length > 0 ? (
          <Section title={say(v.offer)}>
            <div className="space-y-10">
              {site.properties.map((p) => (
                <article key={p.id} className="overflow-hidden rounded-2xl border border-slate-200">
                  {p.imageUrls[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrls[0]} alt={p.name} className="h-56 w-full object-cover sm:h-72" loading="lazy" />
                  ) : null}
                  <div className="p-5">
                    <h3 className="text-xl font-semibold">{p.name}</h3>
                    {p.description ? <p className="mt-2 text-sm leading-6 text-slate-600">{p.description}</p> : null}
                    {p.amenities.length > 0 ? (
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {p.amenities.map((a) => (
                          <li key={a} className="rounded-full bg-[var(--soft)] px-3 py-1 text-xs font-medium">
                            {a}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <p className="mt-3 text-xs text-slate-500">
                      {say(LABELS.checkIn)} {p.checkInTime} · {say(LABELS.checkOut)} {p.checkOutTime}
                    </p>
                    <Items items={allItems.filter((i) => i.propertyId === p.id)} say={say} stay />
                  </div>
                </article>
              ))}
            </div>
          </Section>
        ) : (
          <Section title={say(v.offer)}>
            <div className="space-y-8">
              {site.categories.map((c) => (
                <div key={c.id}>
                  {c.name && site.categories.length > 1 ? <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--accent)]">{c.name}</h3> : null}
                  <Items items={c.items} say={say} />
                </div>
              ))}
            </div>
          </Section>
        )}

        {hasVisit ? (
          <Section title={say(LABELS.visit)}>
            <dl className="grid gap-6 rounded-2xl bg-[var(--soft)] p-6 sm:grid-cols-3">
              {site.profile.address ? <Fact label={say(LABELS.address)}>{site.profile.address}</Fact> : null}
              {site.profile.hours ? <Fact label={say(LABELS.hours)}>{site.profile.hours}</Fact> : null}
              {site.profile.phone ? (
                <Fact label={say(LABELS.phone)}>
                  <a href={`tel:${site.profile.phone.replace(/\s/g, "")}`} dir="ltr" className="underline">
                    {site.profile.phone}
                  </a>
                </Fact>
              ) : null}
            </dl>
            {site.profile.mapsUrl ? (
              <a href={site.profile.mapsUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm font-semibold text-[var(--accent)] underline">
                {say(LABELS.directions)}
              </a>
            ) : null}
          </Section>
        ) : null}

        {site.facts.length > 0 ? (
          <Section title={say(LABELS.good)}>
            <ul className="space-y-2 text-sm leading-6 text-slate-700">
              {site.facts.map((f) => (
                <li key={f} dir="auto" className="flex gap-2">
                  <span aria-hidden="true" className="text-[var(--accent)]">
                    •
                  </span>
                  {f}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </main>

      <footer className="border-t border-slate-100 pb-24 pt-6 sm:pb-6">
        <p className="mx-auto max-w-5xl px-4 text-xs text-slate-400">
          {site.name} · {say(LABELS.powered)}{" "}
          <a href="https://app.ordr.ae" className="underline">
            ordr.ae
          </a>
        </p>
      </footer>

      {/* Phones: the booking button stays within thumb reach while reading. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-100 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:hidden">
        <a href={bookHref} {...external} className="block rounded-full bg-[var(--accent)] py-3 text-center text-sm font-semibold text-white">
          {say(v.cta)}
        </a>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-5 text-2xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm leading-6" dir="auto">
        {children}
      </dd>
    </div>
  );
}

function Items({ items, say, stay = false }: { items: SiteItem[]; say: (w: Words) => string; stay?: boolean }) {
  if (items.length === 0) return null;
  return (
    <ul className={`grid gap-3 sm:grid-cols-2 ${stay ? "mt-5" : ""}`}>
      {items.map((i) => (
        <li key={i.id} className="flex items-start gap-3 rounded-xl border border-slate-200 p-4">
          {i.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={i.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" loading="lazy" />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{i.name}</span>
              <span className="shrink-0 text-sm font-semibold" dir="ltr">
                {i.price}
              </span>
            </div>
            {i.description ? <p className="mt-1 text-sm leading-5 text-slate-600">{i.description}</p> : null}
            <p className="mt-1 text-xs text-slate-500">
              {stay ? say(LABELS.perNight) : null}
              {stay && i.maxGuests ? ` · ${say(LABELS.sleeps)} ${i.maxGuests}` : null}
              {!stay && i.durationMinutes ? `${i.durationMinutes} ${say(LABELS.min)}` : null}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
