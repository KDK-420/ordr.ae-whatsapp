/** Content for the public site. Plain data so the pages stay simple and the copy is easy to change. */

export interface ChatLine {
  from: "customer" | "bot";
  text: string;
  /** Milliseconds before this line appears in the animation. */
  delay?: number;
}

export interface Vertical {
  slug: string;
  name: string;
  short: string;
  status: "live" | "soon";
  /** Hero line for the vertical page. */
  headline: string;
  sub: string;
  /** What the AI handles for this kind of business. */
  handles: string[];
  conversation: ChatLine[];
  faq: Array<{ q: string; a: string }>;
}

export const VERTICALS: Vertical[] = [
  {
    slug: "salons",
    name: "Salons and spas",
    short: "Bookings, reminders, no-shows handled",
    status: "live",
    headline: "Your salon's receptionist on WhatsApp, awake 24/7.",
    sub: "Customers message the way they always have. The AI checks real availability, books with the right stylist, confirms, reminds, and hands over to you when it should.",
    handles: ["Appointment booking with the right stylist or 'anyone available'", "Reminders 24 hours and 2 hours before, in the customer's language", "Cancellations and 'when is my appointment?'", "Prices, durations, opening hours, parking, policies", "Handing over to a person for rescheduling, complaints or VIPs"],
    conversation: [
      { from: "customer", text: "hi, any chance of a haircut tomorrow afternoon?" },
      { from: "bot", text: "Hi Noor! Tomorrow afternoon I have 15:00 or 16:30 with Sara. Which works?", delay: 1400 },
      { from: "customer", text: "15:00 please", delay: 1600 },
      { from: "bot", text: "Haircut with Sara, Wednesday 15:00, AED 80. Shall I book it?", delay: 1200 },
      { from: "customer", text: "yes", delay: 1100 },
      { from: "bot", text: "Done, booking #142. See you Wednesday at 15:00! I'll remind you the day before.", delay: 1300 },
    ],
    faq: [
      { q: "Can customers pick a specific stylist?", a: "Yes. Each team member has their own hours and the services they do. Customers can ask for someone by name or take whoever is free first." },
      { q: "What happens with no-shows and late cancellations?", a: "Reminders go out 24 hours and 2 hours before. Cancellations free the slot immediately. Your policy (for example a fee under 2 hours) is something the AI tells customers if you add it to its facts." },
    ],
  },
  {
    slug: "restaurants",
    name: "Restaurants and cafés",
    short: "Orders, pickup and delivery on WhatsApp",
    status: "live",
    headline: "Take orders where your customers already are.",
    sub: "A bilingual menu, cart and checkout inside WhatsApp, with a live order board for the kitchen and a status message to the customer at every step.",
    handles: ["Menu with photos, modifiers and sizes, in Arabic and English", "Pickup, delivery with a shared location, dine-in", "Order updates: accepted, preparing, ready, on its way", "Questions about dishes, allergens, hours and delivery areas", "Handing over to staff for special requests"],
    conversation: [
      { from: "customer", text: "2 chicken shawarma and a large fries to deliver" },
      { from: "bot", text: "Got it: 2× Chicken Shawarma, 1× Fries (large). AED 46. Where should we deliver?", delay: 1400 },
      { from: "customer", text: "📍 Marina Gate 2", delay: 1500 },
      { from: "bot", text: "Perfect, delivery AED 10, total AED 56, cash on delivery. Confirm?", delay: 1200 },
      { from: "customer", text: "confirm", delay: 1000 },
      { from: "bot", text: "Order #318 is in. About 35 minutes. I'll message you when it's on its way.", delay: 1300 },
    ],
    faq: [
      { q: "Does it work with my POS?", a: "Orders arrive on the ordr.ae board today, with printing and POS connections on the roadmap. Tell us which POS you run." },
      { q: "Can I take payment in the chat?", a: "Cash on delivery and pickup today; payment links are next." },
    ],
  },
  {
    slug: "clinics",
    name: "Clinics",
    short: "Appointments, reminders, patient questions",
    status: "soon",
    headline: "Fewer missed appointments, fewer phone calls.",
    sub: "Patients book and confirm on WhatsApp; the front desk sees a calendar, not a queue of calls.",
    handles: ["Appointment booking per doctor or service", "Reminders and confirmations", "Insurance, location and preparation questions", "Handing over to the front desk"],
    conversation: [
      { from: "customer", text: "I need a dental cleaning this week" },
      { from: "bot", text: "Thursday 10:30 or Saturday 13:00 with Dr. Hana are free. Which suits you?", delay: 1400 },
      { from: "customer", text: "Saturday", delay: 1200 },
      { from: "bot", text: "Booked: cleaning with Dr. Hana, Saturday 13:00. Please arrive 10 minutes early with your Emirates ID.", delay: 1300 },
    ],
    faq: [],
  },
  {
    slug: "fitness",
    name: "Padel, gyms and classes",
    short: "Court and class bookings, memberships",
    status: "soon",
    headline: "Courts and classes booked in the chat.",
    sub: "Members book courts and classes, get reminders, and ask about memberships without calling the desk.",
    handles: ["Court and class booking with capacity", "Recurring schedules and waitlists", "Membership questions", "Handing over to staff"],
    conversation: [
      { from: "customer", text: "court for 4 tonight at 8?" },
      { from: "bot", text: "Court 2 is free 20:00–21:30 tonight, AED 180. Book it?", delay: 1400 },
      { from: "customer", text: "yes", delay: 1000 },
      { from: "bot", text: "Court 2 is yours tonight 20:00. See you there!", delay: 1200 },
    ],
    faq: [],
  },
];

export const STEPS = [
  { n: "01", title: "We set up your number", body: "Keep your WhatsApp number or get one from us. We load your services, team, hours and menu. No app for your customers, nothing to install for you." },
  { n: "02", title: "Your AI receptionist takes over", body: "It answers in seconds, in Arabic or English, checks real availability and books. Every price and time comes from your data; it never guesses." },
  { n: "03", title: "You run the day from one screen", body: "Calendar, orders, inbox. Confirm with one tap, take over any chat, and the customer gets a WhatsApp update at each step." },
];

export const FEATURES = [
  { title: "Talks like your best staff", body: "Natural conversation, not menus. Short replies, one question at a time, confirms once and books." },
  { title: "Never invents anything", body: "Prices, durations, availability and bookings come from your catalog and calendar through a locked-down set of tools." },
  { title: "Hands over when it should", body: "Complaints, VIPs, rescheduling or anything it is unsure about go to your inbox with the context; the AI waits until you hand it back." },
  { title: "Arabic and English", body: "Follows the language of the customer, including reminders and confirmations." },
  { title: "Reminders that cut no-shows", body: "24 hours and 2 hours before, automatically, with Meta-approved templates when the chat window has closed." },
  { title: "A dashboard your team will use", body: "Calendar by stylist, order board, inbox with AI-drafted replies, catalog and team editing." },
  { title: "Your number, done for you", body: "We are set up on the WhatsApp Cloud API. You never open a Meta dashboard." },
  { title: "Built for the UAE", body: "AED, VAT, Asia/Dubai, Friday hours, Arabic first. Hosted and operated from Dubai." },
];

export const FAQ = [
  { q: "Do I keep my WhatsApp number?", a: "You can bring an existing business number or take one of ours. Either way customers see your name and logo." },
  { q: "What if the AI cannot answer?", a: "It says so and hands the chat to your team with the full context. It never guesses a price or a time: every answer comes from your own data." },
  { q: "Does it really understand Arabic?", a: "Yes, including Gulf dialect in everyday booking and ordering. It replies in the language the customer writes in." },
  { q: "How long until we are live?", a: "A salon or restaurant is usually live within two working days: one call to collect services, team and hours, then a test on your phone." },
  { q: "What does it cost?", a: "A monthly plan per location with setup included. WhatsApp's own fees are tiny for this use (free replies inside 24 hours, a few fils for reminders). Book a demo and we will price your case." },
  { q: "Where is the data?", a: "On servers we operate in the region, scoped per business. Only the booking and ordering details are stored; chats stay yours." },
];

export const STATS = [
  { value: "< 5 s", label: "typical reply time" },
  { value: "24/7", label: "bookings and orders" },
  { value: "2", label: "languages, one conversation" },
  { value: "0", label: "apps to install" },
];

export function verticalBySlug(slug: string): Vertical | undefined {
  return VERTICALS.find((v) => v.slug === slug);
}
