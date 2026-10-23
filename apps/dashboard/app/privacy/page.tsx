import type { Metadata } from "next";
import { contactLinks, SiteFooter, SiteNav } from "@/components/marketing/site";

export const metadata: Metadata = {
  title: "Privacy policy · ordr.ae",
  description: "How ordr.ae handles the messages, bookings, orders and preferences of customers who talk to businesses through WhatsApp and web chat.",
};

const UPDATED = "23 October 2026";

/**
 * Public privacy policy. Meta requires a privacy policy URL before the WhatsApp app can go live,
 * and customers reach this page from the web chat. Keep it in plain language; it is a product
 * description, not a legal shield (see ADR 0003 for the memory and consent design).
 */
export default function PrivacyPage() {
  const { email } = contactLinks();
  return (
    <main className="bg-white">
      <SiteNav />
      <article className="mx-auto max-w-3xl px-5 pb-20 pt-14">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">Privacy policy</p>
        <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight">How ordr.ae handles your data</h1>
        <p className="mt-4 text-sm text-slate-500">Last updated {UPDATED}</p>

        <Section title="Who we are">
          <p>
            ordr.ae is operated by Kdk420 General Trading LLC, Dubai, United Arab Emirates (&quot;ordr.ae&quot;, &quot;we&quot;). We provide an AI
            assistant that businesses (&quot;merchants&quot;) use to take bookings and orders from their customers over WhatsApp and web chat.
            When you message a merchant that uses ordr.ae, the merchant decides what is collected and why; we process it on the
            merchant&apos;s behalf. Questions about a specific business&apos;s use of your data go to that business first, and to us at{" "}
            <a href={`mailto:${email}`} className="text-brand underline">
              {email}
            </a>
            .
          </p>
        </Section>

        <Section title="What we collect">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Messages.</strong> The text, buttons, images, documents, voice notes and locations you send to a merchant, and the
              replies sent back. WhatsApp messages reach us through Meta&apos;s WhatsApp Business Platform; web chat messages reach us
              directly from the chat page.
            </li>
            <li>
              <strong>Your WhatsApp number and profile name</strong>, as provided by WhatsApp, or a random visitor id for web chat. We use
              them to keep your conversation together and to send replies.
            </li>
            <li>
              <strong>Bookings and orders</strong> you make: the service or products, time, staff, price, and the status of the booking or
              order. Payments are taken on a payment provider&apos;s page; we store the amount and whether it succeeded, never card details.
            </li>
            <li>
              <strong>Preferences you ask us to remember</strong>, such as a preferred stylist or a usual order. These are stored only
              after you say yes when the assistant asks, and never include health, financial, identity-document or other sensitive
              details.
            </li>
            <li>
              <strong>Technical records</strong>: delivery status of messages, timestamps, and a log of what the assistant did to answer
              you (which lookups it made, how long it took). Merchants can read these to check the assistant&apos;s work.
            </li>
          </ul>
        </Section>

        <Section title="How we use it">
          <ul className="list-disc space-y-2 pl-5">
            <li>To understand your message and reply, including checking availability, holding a slot, placing an order and sending confirmations and reminders.</li>
            <li>To let the merchant&apos;s staff read the conversation, take over from the assistant, and manage your booking or order.</li>
            <li>To remember preferences you consented to, so you do not have to repeat them next time with the same merchant.</li>
            <li>To keep the service reliable and secure, and to investigate problems you or the merchant report.</li>
          </ul>
          <p>We do not sell personal data, show advertising, or use your conversations to build profiles across different merchants.</p>
        </Section>

        <Section title="The AI assistant">
          <p>
            Replies are generated with Claude, a model from Anthropic. To answer you, the relevant part of your conversation, the
            merchant&apos;s catalogue and opening hours, and any preferences you consented to are sent to Anthropic&apos;s API. Anthropic
            processes this data to generate the reply and does not use it to train its models. Every price, time, booking and order
            the assistant mentions comes from the merchant&apos;s records, not from the model&apos;s memory.
          </p>
        </Section>

        <Section title="Who else sees it">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>The merchant</strong> you are talking to: their staff see the conversation, bookings and orders in their dashboard.
            </li>
            <li>
              <strong>Meta Platforms</strong>, which delivers WhatsApp messages under its own terms and privacy policy.
            </li>
            <li>
              <strong>Anthropic</strong>, which generates replies as described above.
            </li>
            <li>
              <strong>Our hosting provider</strong>, where our servers run. We host the service in the United Arab Emirates where a suitable
              location is available.
            </li>
          </ul>
          <p>We share data with authorities only when the law requires it.</p>
        </Section>

        <Section title="How long we keep it">
          <ul className="list-disc space-y-2 pl-5">
            <li>Conversations, bookings and orders are kept for as long as the merchant uses ordr.ae, so that staff can look back at history, and deleted when the merchant&apos;s account closes.</li>
            <li>Remembered preferences expire automatically after one year unless renewed, and are deleted at once if you withdraw consent.</li>
            <li>Technical logs are kept for a short period for troubleshooting.</li>
          </ul>
        </Section>

        <Section title="Your choices">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Memory.</strong> Tell the assistant &quot;forget me&quot; or &quot;stop remembering&quot; in the chat. Everything remembered about you with
              that merchant is deleted, and nothing new is stored unless you agree again. Ask &quot;what do you remember about me?&quot; at any
              time to see it.
            </li>
            <li>
              <strong>Talk to a person.</strong> Ask for a human at any point and the assistant hands the conversation to the merchant&apos;s team.
            </li>
            <li>
              <strong>Access, correction and deletion.</strong> You can ask the merchant, or us at the address above, to show you the data
              held about you, correct it, or delete it. We answer within 30 days. Deleting a booking or order record may not be possible
              where the merchant must keep it for accounting.
            </li>
            <li>
              <strong>Stop messages.</strong> Reply &quot;stop&quot; or block the number on WhatsApp. Confirmations and reminders for bookings you made
              may still be sent until the booking is over.
            </li>
          </ul>
        </Section>

        <Section title="Security">
          <p>
            Messages travel over encrypted connections. Access to merchant dashboards requires a login, and each merchant can only see
            its own customers. Payment card details never pass through our systems.
          </p>
        </Section>

        <Section title="Children">
          <p>The service is meant for adults making bookings and purchases. We do not knowingly collect data from children under 18.</p>
        </Section>

        <Section title="Changes">
          <p>
            When this policy changes we update the date at the top. Material changes are also announced to merchants, who are
            responsible for informing their customers.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Kdk420 General Trading LLC, Dubai, United Arab Emirates ·{" "}
            <a href={`mailto:${email}`} className="text-brand underline">
              {email}
            </a>
          </p>
        </Section>
      </article>
      <SiteFooter />
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 space-y-3 text-[15px] leading-7 text-slate-700">
      <h2 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
      {children}
    </section>
  );
}
