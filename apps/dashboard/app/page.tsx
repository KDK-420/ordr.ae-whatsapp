import type { Metadata } from "next";
import { ChatDemo } from "@/components/marketing/chat-demo";
import { CallToAction, contactLinks, Faq, Features, HowItWorks, Industries, SiteFooter, SiteNav, Stats } from "@/components/marketing/site";
import { VERTICALS } from "@/lib/marketing";

// Contact links come from the environment at request time so the container can set them without a rebuild.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ordr.ae · AI receptionist for WhatsApp",
  description: "Bookings and orders handled on WhatsApp by an AI that talks like your staff, in Arabic and English. For salons, restaurants and clinics in the UAE.",
  openGraph: { title: "ordr.ae · AI receptionist for WhatsApp", description: "Bookings and orders handled on WhatsApp, in Arabic and English.", type: "website" },
};

export default function LandingPage() {
  const { bookDemo, tryDemo } = contactLinks();
  const salon = VERTICALS[0]!;
  return (
    <main className="bg-white">
      <SiteNav />

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-14 md:grid-cols-[1.15fr_1fr] md:pb-24 md:pt-20">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">WhatsApp · Arabic and English · UAE</p>
          <h1 className="mt-3 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
            An AI receptionist that books and sells on WhatsApp, like your best staff would.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-slate-600">
            Customers message your number and get a real answer in seconds: free times, prices, a booking, an order. No menus to tap, no app to install, and a person steps in whenever it
            matters.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={bookDemo} className="rounded-md bg-brand px-5 py-3 text-sm font-semibold text-white hover:bg-brand-dark">
              Book a demo
            </a>
            {tryDemo ? (
              <a href={tryDemo} className="rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-semibold hover:border-slate-400">
                Message the demo salon
              </a>
            ) : null}
          </div>
          <p className="mt-4 text-xs text-slate-500">Built on the WhatsApp Cloud API. Your number, your brand, our setup.</p>
        </div>
        <ChatDemo lines={salon.conversation} title="Glow Salon" />
      </section>

      <Stats />
      <HowItWorks />
      <Industries />
      <Features />
      <Faq />
      <CallToAction />
      <SiteFooter />
    </main>
  );
}
