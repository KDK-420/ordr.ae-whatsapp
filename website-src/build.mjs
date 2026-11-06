// Generates every page, sitemap and robots.txt into website/. Run after editing home.mjs or pages.mjs
// and commit the output: `node website-src/build.mjs`.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { home } from "./home.mjs";
import { pages } from "./pages.mjs";

const HOSTS = { main: "https://ordr.ae", pos: "https://pos.ordr.ae", booking: "https://booking.ordr.ae" };
const SITE = HOSTS.main;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "website");
const UPDATED = "2026-11-06";
const BROWSER_DEMO = "https://app.ordr.ae/chat/demo-salon";
const FONTS = {
  en: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap",
  ar: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap",
};

const UI = {
  en: {
    dir: "ltr", locale: "en_AE", whatsapp: "https://wa.me/971509397420?text=Hi", next: "→", out: "↗", back: "‹",
    home: "Home", nav: "Primary", openNav: "Open navigation", products: "Products", howItWorks: "How it works", industries: "Industries", questions: "Questions",
    otherLang: "العربية", otherLangCode: "ar", tryFree: "Try ordr Free", browser: "Try it in your browser",
    note: "Arabic and English. Nothing for your customers to install.", messagePlaceholder: "Message...", online: "online · AI assistant",
    faqLabel: "Frequently asked", faqTitle: "Questions?<br>We have answers.", faqIntro: "Straight answers about how this works in practice.",
    related: "Keep reading", relatedTitle: "More from ordr.", detail: "In detail", closing: "Your next customer is already on WhatsApp.", closingSub: "Give them a better way to reach your business.",
    posName: "ordr POS", bookingName: "ordr Booking", alsoFor: "Also for:", allIndustries: "See all industries", more: "More",
    privacy: "Privacy", signIn: "Sign in", copyright: "© 2026 ordr.ae, by Kdk420 General Trading LLC, Dubai", tagline: "Built to make business feel effortless.",
    brand: "AI-assisted conversations for bookings and orders on WhatsApp.", crumbs: "Breadcrumb", exampleChat: "Example WhatsApp conversation", homeLabel: "ordr home",
  },
  ar: {
    dir: "rtl", locale: "ar_AE", whatsapp: "https://wa.me/971509397420?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7", next: "←", out: "↖", back: "›",
    home: "الرئيسية", nav: "القائمة الرئيسية", openNav: "فتح القائمة", products: "المنتجات", howItWorks: "كيف يعمل", industries: "القطاعات", questions: "الأسئلة",
    otherLang: "English", otherLangCode: "en", tryFree: "جرّب ordr مجاناً", browser: "جرّبه من المتصفح",
    note: "بالعربية والإنجليزية. لا يحتاج عملاؤك إلى تثبيت أي شيء.", messagePlaceholder: "اكتب رسالة...", online: "متصل · مساعد ذكي",
    faqLabel: "الأسئلة الشائعة", faqTitle: "لديك أسئلة؟<br>لدينا الإجابات.", faqIntro: "إجابات مباشرة عن طريقة عمله على أرض الواقع.",
    related: "تابع القراءة", relatedTitle: "المزيد من ordr.", detail: "بالتفصيل", closing: "عميلك القادم موجود على واتساب بالفعل.", closingSub: "امنحه طريقة أفضل للوصول إلى عملك.",
    posName: "ordr POS", bookingName: "ordr Booking", alsoFor: "ويناسب أيضاً:", allIndustries: "جميع القطاعات", more: "المزيد",
    privacy: "الخصوصية", signIn: "تسجيل الدخول", copyright: "© 2026 ordr.ae، من شركة Kdk420 General Trading LLC، دبي", tagline: "صُمم ليجعل إدارة عملك أسهل.",
    brand: "محادثات مدعومة بالذكاء الاصطناعي للحجوزات والطلبات عبر واتساب.", crumbs: "مسار التنقل", exampleChat: "مثال على محادثة واتساب", homeLabel: "الصفحة الرئيسية لـ ordr",
  },
};

const stroke = (viewBox, paths) => `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  pos: stroke("0 0 32 32", `<path d="M5 12h22v15H5zM9 12V7h14v5M10 18h12M10 22h5m4 0h3"/>`),
  booking: stroke("0 0 32 32", `<rect x="4" y="7" width="24" height="21" rx="2"/><path d="M10 3v8m12-8v8M4 14h24M10 20h4m4 0h4m-12 5h4"/>`),
  connect: stroke("0 0 32 32", `<path d="M16 4a12 12 0 0 0-10.7 17.5L4 28l6.7-1.7A12 12 0 1 0 16 4z"/><path d="M12 11c1 6 4 9 9 10"/>`),
  spark: stroke("0 0 32 32", `<path d="m16 2 3 10 11 4-11 4-3 10-3-10-11-4 11-4z"/>`),
  grow: stroke("0 0 32 32", `<path d="M5 26V16h6v10zm8 0V11h6v15zm8 0V5h6v21z"/>`),
  salon: stroke("0 0 30 30", `<path d="m4 4 22 22M26 4 4 26M9 9l5 5m2 2 5 5"/><circle cx="7" cy="23" r="3"/><circle cx="23" cy="23" r="3"/>`),
  spa: stroke("0 0 30 30", `<path d="M15 25c-6-4-8-9-6-15 4 1 6 4 6 8 0-4 3-7 7-8 1 6-1 11-7 15zM3 18c6-1 10 2 12 7M27 18c-6-1-10 2-12 7"/>`),
  restaurant: stroke("0 0 30 30", `<path d="M7 3v10m4-10v10M4 3v7c0 3 2 4 5 4v13M22 3c-4 5-4 11 0 14h4V3h-4zm2 14v10"/>`),
  shop: stroke("0 0 30 30", `<path d="M5 11h20l-2 16H7L5 11zm5 0V8a5 5 0 0 1 10 0v3"/>`),
  padel: stroke("0 0 30 30", `<ellipse cx="13" cy="11" rx="8" ry="10" transform="rotate(35 13 11)"/><path d="m18 19 9 9M9 7h1m4 0h1M9 12h1m4 0h1"/>`),
  resort: stroke("0 0 30 30", `<path d="M3 22h24M6 22v-8h18v8M8 14V8h14v6M11 8V4h8v4M10 18h4m3 0h4"/>`),
  grocery: stroke("0 0 30 30", `<path d="M3 5h4l3 15h14l3-11H8.5"/><circle cx="12" cy="25" r="2"/><circle cx="22" cy="25" r="2"/>`),
  grid: stroke("0 0 30 30", `<rect x="4" y="4" width="9" height="9" rx="2"/><rect x="17" y="4" width="9" height="9" rx="2"/><rect x="4" y="17" width="9" height="9" rx="2"/><rect x="17" y="17" width="9" height="9" rx="2"/>`),
};
const PAGE_ICON = {
  "whatsapp-chatbot": "connect", "guides/whatsapp-business-api-uae": "spark", industries: "grid",
  "whatsapp-ordering-system": "pos", "restaurant-whatsapp-ordering": "restaurant", "grocery-whatsapp-ordering": "grocery", "sell-on-whatsapp": "shop",
  "whatsapp-booking-system": "booking", "salon-booking-software": "salon", "padel-court-booking-system": "padel", "hotel-whatsapp-booking": "resort",
};

const byId = (slug) => {
  const p = pages.find((x) => x.slug === slug);
  if (!p) throw new Error(`unknown page: ${slug}`);
  return p;
};
// The path of a page on its own host, and its full address.
const localPath = (p, lang) => `${lang === "ar" ? "/ar" : ""}${p.path}`;
const urlOf = (slug, lang) => { const p = byId(slug); return HOSTS[p.host] + localPath(p, lang); };
const homeOf = (lang) => `${SITE}${lang === "ar" ? "/ar/" : "/"}`;
const links = (text, lang) => text.replace(/\{\{([^}]+)\}\}/g, (_, slug) => urlOf(slug, lang));
const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const attr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const text = (s) => s.replace(/&(?!amp;)/g, "&amp;");
// Changes whenever the file does, so returning visitors never pair new pages with old styles.
const asset = (file) => `/assets/${file}?v=${createHash("sha256").update(readFileSync(join(OUT, "assets", file))).digest("hex").slice(0, 8)}`;

function clock(start, minutes) {
  const [h, m] = start.split(":").map(Number);
  const total = (h * 60 + m + minutes) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function document_({ lang, title, description, url, en, ar, ogTitle, ogDescription, ogType, graph, body }) {
  const ui = UI[lang];
  return `<!doctype html>
<html lang="${lang}" dir="${ui.dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${title}</title>
  <meta name="description" content="${attr(description)}">
  <meta name="theme-color" content="#1d222c">
  <link rel="canonical" href="${url}">
  <link rel="alternate" hreflang="en" href="${en}">
  <link rel="alternate" hreflang="ar" href="${ar}">
  <link rel="alternate" hreflang="x-default" href="${en}">
  <meta property="og:title" content="${attr(ogTitle)}">
  <meta property="og:description" content="${attr(ogDescription)}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:url" content="${url}">
  <meta property="og:site_name" content="ordr.ae">
  <meta property="og:locale" content="${ui.locale}">
  <meta property="og:image" content="${SITE}/assets/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${FONTS[lang]}">
  <link rel="stylesheet" href="${asset("styles.css")}">
  <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script>
</head>
<body>
${body}
  <script src="${asset("site.js")}" defer></script>
</body>
</html>
`;
}

// `base` is empty on the home page, where the section links stay on the page.
function topbar(lang, { base, logoHref, otherHref }) {
  const ui = UI[lang];
  const other = ui.otherLangCode;
  const item = (slug) => `<a href="${urlOf(slug, lang)}">${byId(slug).label[lang]}</a>`;
  const productLinks = ["whatsapp-ordering-system", "whatsapp-booking-system"].map(item).join("");
  const industryLinks = ["restaurant-whatsapp-ordering", "grocery-whatsapp-ordering", "sell-on-whatsapp", "salon-booking-software", "padel-court-booking-system", "hotel-whatsapp-booking", "industries"].map(item).join("");
  return `<header class="topbar"><a class="logo" href="${logoHref}" aria-label="${ui.homeLabel}">ordr<b>.ae</b></a><nav class="mainnav" aria-label="${ui.nav}"><div class="nav-drop"><a href="${base}#products">${ui.products} ⌄</a><div class="nav-menu"><div>${productLinks}</div></div></div><div class="nav-drop"><a href="${base}#industries">${ui.industries} ⌄</a><div class="nav-menu"><div>${industryLinks}</div></div></div><a href="${base}#how">${ui.howItWorks}</a><a href="${base}#faq">${ui.questions}</a></nav><div class="nav-right"><a class="lang" href="${otherHref}" lang="${other}" hreflang="${other}">${ui.otherLang}</a><a class="outline-link" href="${ui.whatsapp}" target="_blank" rel="noopener">${ui.tryFree} ${ui.out}</a><button class="mobile-toggle" id="menuBtn" type="button" aria-label="${ui.openNav}" aria-expanded="false">☰</button></div><nav class="mobile-panel" id="mobilePanel" aria-label="${ui.nav}">${productLinks}<a href="${urlOf("industries", lang)}">${ui.industries}</a><a href="${base}#how">${ui.howItWorks}</a><a href="${base}#faq">${ui.questions}</a><a href="${ui.whatsapp}" target="_blank" rel="noopener">${ui.tryFree}</a><a href="${otherHref}" lang="${other}" hreflang="${other}">${ui.otherLang}</a></nav></header>`;
}

function phone(lang, { attrs, avatar, name, back, area, form }) {
  const ui = UI[lang];
  return `<div class="device-zone"><div class="phone" ${attrs}><div class="phone-screen"><div class="island"></div><div class="statusbar" dir="ltr"><span>9:41</span><span>▰ ▰ ▰ ◕ 100%</span></div><div class="chat-header">${back}${avatar}<div>${name}<div class="contact-state">${ui.online}</div></div><span class="more-dot">⋮</span></div>${area}${form}<div class="home-line"></div></div></div></div>`;
}

function staticPhone(chat, lang) {
  const ui = UI[lang];
  const lines = chat.lines.map(([me, line], i) =>
    `<div class="bubble bubble-static ${me ? "user" : "bot"}"><span>${text(line).replace(/\n/g, "<br>")}</span><time>${clock(chat.at, i)}${me ? " ✓✓" : ""}</time></div>`).join("");
  return phone(lang, {
    attrs: `role="img" aria-label="${ui.exampleChat}"`,
    back: `<span class="back" aria-hidden="true">${ui.back}</span>`,
    avatar: `<div class="avatar" aria-hidden="true">${text(chat.name.charAt(0))}</div>`,
    name: `<div class="contact-name">${text(chat.name)}</div>`,
    area: `<div class="chat-area">${lines}</div>`,
    form: `<div class="chat-form" aria-hidden="true"><span class="fake-input">${ui.messagePlaceholder}</span><span class="send">➤</span></div>`,
  });
}

function endCta(lang) {
  const ui = UI[lang];
  return `<section class="end-cta" id="get-started"><div class="shell"><div class="cta-panel"><div><h2>${ui.closing}</h2><p>${ui.closingSub}</p></div><a class="button-primary" href="${ui.whatsapp}" target="_blank" rel="noopener">${ui.tryFree} <span>${ui.out}</span></a></div></div></section>`;
}

function footer(lang) {
  const ui = UI[lang];
  const list = (slugs) => slugs.map((slug) => `<a href="${urlOf(slug, lang)}">${byId(slug).label[lang]}</a>`).join("");
  return `<footer><div class="shell"><div class="footer-layout"><div class="footer-brand"><a class="logo" href="${homeOf(lang)}" aria-label="${ui.homeLabel}">ordr<b>.ae</b></a><p>${ui.brand}</p></div><div class="footer-col"><h4>${ui.posName}</h4>${list(["whatsapp-ordering-system", "restaurant-whatsapp-ordering", "grocery-whatsapp-ordering", "sell-on-whatsapp"])}</div><div class="footer-col"><h4>${ui.bookingName}</h4>${list(["whatsapp-booking-system", "salon-booking-software", "padel-court-booking-system", "hotel-whatsapp-booking"])}</div><div class="footer-col"><h4>${ui.more}</h4>${list(["industries", "whatsapp-chatbot", "guides/whatsapp-business-api-uae"])}<a href="https://app.ordr.ae/privacy">${ui.privacy}</a><a href="https://app.ordr.ae/login">${ui.signIn}</a><a href="mailto:hello@ordr.ae" dir="ltr">hello@ordr.ae</a></div></div><div class="copyright"><span>${ui.copyright}</span><span>${ui.tagline}</span></div></div></footer>`;
}

const faqItems = (items, lang) => items.map(([q, a], i) =>
  `<details class="faq-item" name="faq"${i === 0 ? " open" : ""}><summary class="faq-q">${q} <span aria-hidden="true"></span></summary><div class="faq-a">${links(a, lang)}</div></details>`).join("");

function homePage(lang) {
  const ui = UI[lang];
  const t = home[lang];
  const pos = t.products.pos;
  const booking = t.products.booking;
  const posUrl = urlOf("whatsapp-ordering-system", lang);
  const bookingUrl = urlOf("whatsapp-booking-system", lang);
  const times = ["10:00", "11:30", "14:00", "15:30", "17:00"];
  const graph = [
    { "@type": "Organization", "@id": `${SITE}/#org`, name: "ordr.ae", legalName: "Kdk420 General Trading LLC", url: SITE, logo: `${SITE}/assets/og.png`, email: "hello@ordr.ae", areaServed: "AE" },
    { "@type": "WebSite", "@id": `${SITE}/#site`, url: `${SITE}/`, name: "ordr.ae", inLanguage: ["en", "ar"], publisher: { "@id": `${SITE}/#org` } },
  ];
  const phoneBlock = phone(lang, {
    attrs: `role="group" aria-label="${t.phoneLabel}"`,
    back: `<button class="back" id="resetChat" type="button" aria-label="${t.restart}">${ui.back}</button>`,
    avatar: `<div class="avatar" id="chatAvatar">G</div>`,
    name: `<div class="contact-name" id="chatName">Glow Salon</div>`,
    area: `<div class="chat-area" id="chatArea" role="log" aria-live="polite"></div>`,
    form: `<form class="chat-form" id="chatForm"><label class="sr-only" for="chatInput">${t.messageLabel}</label><input id="chatInput" placeholder="${t.messagePlaceholder}" autocomplete="off"><button class="send" type="submit" aria-label="${t.send}">➤</button></form>`,
  });
  const feature = (href, icon, name, line) => `<a class="feature-trigger" href="${href}"><span class="feature-icon">${ICONS[icon]}</span><div><h3>${name}</h3><p>${line}</p></div><span class="feature-arrow">${ui.next}</span></a>`;
  const body = `<section class="hero" id="home"><div class="shell">${topbar(lang, { base: "", logoHref: "#home", otherHref: homeOf(ui.otherLangCode) })}<div class="stage"><div class="hero-copy"><div class="eyebrow">${t.eyebrow}</div><h1>${t.h1}</h1><p>${t.lead}</p><div class="cta-row"><a class="button-primary" href="${ui.whatsapp}" target="_blank" rel="noopener">${ui.tryFree} <span>${ui.next}</span></a><button class="watch" id="watchDemo" type="button"><span class="watch-icon">▶</span> <span>${t.watch}</span></button></div></div>${phoneBlock}<div class="feature-stack">${feature(posUrl, "pos", ui.posName, t.pos)}${feature(bookingUrl, "booking", ui.bookingName, t.booking)}</div></div><div class="industry-rail"><span>${t.rail}</span>${t.railItems.map(([key, label], i) => `<button type="button" data-industry="${key}"${i === 0 ? ' class="active"' : ""}>${label}</button>`).join("")}<a href="#industries" aria-label="${t.railMore}">${ui.next}</a></div></div></section>
<main>
<section class="stats" aria-label="${t.statsLabel}"><div class="shell stats-row">${t.stats.map(([a, b]) => `<div class="stat"><strong>${a}</strong><p>${b}</p></div>`).join("")}</div></section>
<section class="section process" id="how"><div class="shell process-grid"><div><p class="section-label">${t.how.label}</p><h2>${t.how.h2}</h2><p class="section-intro">${t.how.intro}</p></div><div class="steps">${t.how.steps.map(([num, h, p], i) => `<article class="step"><span class="step-num">${num}</span>${ICONS[["connect", "spark", "grow"][i]]}<h3>${h}</h3><p>${p}</p></article>`).join("")}</div></div></section>
<section class="section products-section" id="products"><div class="shell"><div class="section-header"><div><p class="section-label">${t.products.label}</p><h2>${t.products.h2}</h2></div><p class="section-intro">${t.products.intro}</p></div><div class="product-grid"><article class="product-card"><div class="card-copy"><span class="pill">${text(pos.pill)}</span><h3>${ui.posName}</h3><p>${pos.p}</p><a class="product-link" href="${posUrl}">${pos.link} ${ui.out}</a></div><div class="product-visual pos" aria-hidden="true"><div class="visual-menu"><div class="vm-head"><span>${pos.menu}</span><span>☰</span></div>${pos.items.map(([name, sub, price], i) => `<div class="menu-row"><span class="food-icon">0${i + 1}</span><span><b>${name}</b><small>${sub}</small></span><span>${price}</span></div>`).join("")}</div><div class="order-note">${pos.note}</div></div></article><article class="product-card"><div class="card-copy"><span class="pill">${text(booking.pill)}</span><h3>${ui.bookingName}</h3><p>${booking.p}</p><a class="product-link" href="${bookingUrl}">${booking.link} ${ui.out}</a></div><div class="product-visual" aria-hidden="true"><div class="calendar-card"><div class="calendar-top"><b>${booking.title}</b><span>${booking.month}</span></div><div class="calendar-grid">${booking.days.map((d) => `<div>${d}</div>`).join("")}${times.map((x, i) => `<div${i === 2 ? ' class="sel"' : ""}>${x}</div>`).join("")}${times.map((x) => `<div>${x}</div>`).join("")}</div></div><div class="booking-chip">${booking.note}</div></div></article></div></div></section>
<section class="platform" id="platform"><div class="shell platform-layout"><div class="dashboard" role="img" aria-label="${t.platform.preview}"><div class="dash-sidebar"><strong dir="ltr">ordr<span>.ae</span></strong>${t.platform.nav.map((n, i) => `<div class="dash-link${i === 0 ? " selected" : ""}">${"▦▤▧▣☷"[i]} &nbsp; ${n}</div>`).join("")}</div><div class="dash-body"><div class="dash-h">${t.platform.head}<small>${t.platform.sub}</small></div><div class="mini-metrics">${t.platform.metrics.map(([a, b]) => `<div class="metric"><small>${a}</small><strong>${b}</strong><em>${t.platform.demoData}</em></div>`).join("")}</div><div class="chart"><div class="chart-title">${t.platform.chart}</div><svg viewBox="0 0 500 100" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#30c58a" stop-opacity=".3"/><stop offset="1" stop-color="#30c58a" stop-opacity="0"/></linearGradient></defs><path d="M0 82Q30 60 60 70T120 55T180 52T240 34T300 45T360 27T420 23T500 7V100H0Z" fill="url(#area)"/><path d="M0 82Q30 60 60 70T120 55T180 52T240 34T300 45T360 27T420 23T500 7" fill="none" stroke="#21b97e" stroke-width="3"/></svg></div></div></div><div><p class="section-label">${t.platform.label}</p><h2 class="large-title">${t.platform.h2}</h2><p class="section-intro">${t.platform.intro}</p><div class="platform-features">${t.platform.features.map((f) => `<div class="platform-feature"><span class="check">✓</span><span>${f}</span></div>`).join("")}</div></div></div></section>
<section class="section industry-section" id="industries"><div class="shell"><div class="section-header"><div><p class="section-label">${t.industries.label}</p><h2>${t.industries.h2}</h2></div><p class="section-intro">${t.industries.intro}</p></div><div class="industry-cards">${t.industries.cards.map(([icon, slug, h, p]) => `<a class="industry-card" href="${urlOf(slug, lang)}">${ICONS[icon]}<h3>${text(h)}</h3><p>${p}</p></a>`).join("")}</div><p class="also"><a class="section-arrow" href="${urlOf("industries", lang)}">${t.industries.all} ${ui.next}</a></p></div></section>
<section class="section proof"><div class="shell"><div class="section-header"><div><p class="section-label">${t.proof.label}</p><h2>${t.proof.h2}</h2></div></div><div class="benefit-grid">${t.proof.items.map(([a, b]) => `<div class="benefit"><b>${a}</b><p>${b}</p></div>`).join("")}</div></div></section>
<section class="section faq" id="faq"><div class="shell faq-grid"><div><p class="section-label">${ui.faqLabel}</p><h2>${ui.faqTitle}</h2><p class="section-intro">${t.faqIntro}</p></div><div class="faq-list">${faqItems(t.faq, lang)}</div></div></section>
${endCta(lang)}
</main>
${footer(lang)}
<div class="modal" id="demoModal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-card"><button class="close-modal" id="closeModal" type="button" aria-label="${t.modal.close}">×</button><h2 id="modalTitle">${t.modal.title}</h2><p>${t.modal.p}</p><div class="modal-actions"><button type="button" data-modal-demo="salon">${t.modal.booking}</button><button type="button" data-modal-demo="restaurant">${t.modal.order}</button><a href="${ui.whatsapp}" target="_blank" rel="noopener">${t.modal.real} ${ui.out}</a></div></div></div>`;
  return document_({ lang, title: t.title, description: t.description, url: homeOf(lang), en: homeOf("en"), ar: homeOf("ar"), ogTitle: t.ogTitle, ogDescription: t.ogDescription, ogType: "website", graph, body });
}

function page(p, lang) {
  const ui = UI[lang];
  const c = p[lang];
  const other = ui.otherLangCode;
  const url = urlOf(p.slug, lang);
  const base = homeOf(lang);
  const card = (slug) => {
    const r = byId(slug);
    return `<a class="industry-card" href="${urlOf(slug, lang)}">${ICONS[PAGE_ICON[slug]]}<h3>${r.label[lang]}</h3><p>${attr(r[lang].description)}</p></a>`;
  };
  const related = (p.en.related ?? []).map(card).join("");
  const children = (p.children ?? []).map(card).join("");
  const parent = p.parent ? byId(p.parent) : null;
  const breadcrumb = [
    { name: ui.home, item: homeOf(lang) },
    ...(parent ? [{ name: parent.label[lang], item: urlOf(parent.slug, lang) }] : []),
    { name: p.label[lang], item: url },
  ];
  const graph = [
    { "@type": "BreadcrumbList", itemListElement: breadcrumb.map((b, i) => ({ "@type": "ListItem", position: i + 1, name: b.name, item: b.item })) },
    { "@type": "FAQPage", mainEntity: c.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: plain(links(a, lang)) } })) },
  ];
  if (p.guide) {
    graph.push({ "@type": "Article", headline: plain(c.h1), description: c.description, inLanguage: lang, datePublished: UPDATED, dateModified: UPDATED, mainEntityOfPage: url, image: `${SITE}/assets/og.png`, author: { "@type": "Organization", name: "ordr.ae", url: SITE }, publisher: { "@type": "Organization", name: "ordr.ae", logo: { "@type": "ImageObject", url: `${SITE}/assets/og.png` } } });
  }
  const sections = c.sections.map((s) => `<h2>${s.h}</h2><p>${links(s.p, lang)}</p>${s.ticks ? `<ul class="ticks">${s.ticks.map((t) => `<li>${t}</li>`).join("")}</ul>` : ""}`).join("");
  const body = `<section class="hero hero-page" id="home"><div class="shell">${topbar(lang, { base, logoHref: base, otherHref: urlOf(p.slug, other) })}<div class="stage ${c.chat ? "stage-page" : "stage-text"}"><div class="hero-copy"><nav class="crumbs" aria-label="${ui.crumbs}"><a href="${base}">${ui.home}</a> <span aria-hidden="true">/</span> ${parent ? `<a href="${urlOf(parent.slug, lang)}">${parent.label[lang]}</a> <span aria-hidden="true">/</span> ` : ""}<span aria-current="page">${p.label[lang]}</span></nav><h1>${c.h1}</h1><p>${c.lead}</p><div class="cta-row"><a class="button-primary" href="${ui.whatsapp}" target="_blank" rel="noopener">${ui.tryFree} <span>${ui.next}</span></a><a class="watch" href="${BROWSER_DEMO}"><span class="watch-icon">▶</span> <span>${ui.browser}</span></a></div><p class="hero-note">${ui.note}</p></div>${c.chat ? staticPhone(c.chat, lang) : ""}</div></div></section>
<main>
${children ? `<section class="section products-section"><div class="shell"><div class="section-header"><div><p class="section-label">${ui.industries}</p><h2>${c.childrenTitle}</h2></div></div><div class="industry-cards">${children}</div><p class="also"><strong>${ui.alsoFor}</strong> ${c.also} <a href="${urlOf("industries", lang)}">${ui.allIndustries}</a></p></div></section>
` : ""}<section class="section"><div class="shell faq-grid"><div class="article-side"><p class="section-label">${ui.detail}</p><p class="article-title">${p.label[lang]}</p></div><div class="article">${sections}</div></div></section>
<section class="section faq" id="faq"><div class="shell faq-grid"><div><p class="section-label">${ui.faqLabel}</p><h2>${ui.faqTitle}</h2><p class="section-intro">${ui.faqIntro}</p></div><div class="faq-list">${faqItems(c.faq, lang)}</div></div></section>
<section class="section section-related"><div class="shell"><div class="section-header"><div><p class="section-label">${ui.related}</p><h2>${ui.relatedTitle}</h2></div></div><div class="industry-cards">${related}</div></div></section>
${endCta(lang)}
</main>
${footer(lang)}`;
  return document_({ lang, title: c.title, description: c.description, url, en: urlOf(p.slug, "en"), ar: urlOf(p.slug, "ar"), ogTitle: c.title, ogDescription: c.description, ogType: p.guide ? "article" : "website", graph, body });
}

function sitemap(host) {
  const entry = (en, ar, priority) => [en, ar].map((loc) => `  <url>
    <loc>${loc}</loc>
    <lastmod>${UPDATED}</lastmod>
    <priority>${priority}</priority>
    <xhtml:link rel="alternate" hreflang="en" href="${en}"/>
    <xhtml:link rel="alternate" hreflang="ar" href="${ar}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${en}"/>
  </url>`).join("\n");
  const urls = pages.filter((p) => p.host === host).map((p) => entry(urlOf(p.slug, "en"), urlOf(p.slug, "ar"), p.path === "/" ? "1.0" : "0.8"));
  if (host === "main") urls.unshift(entry(`${SITE}/`, `${SITE}/ar/`, "1.0"));
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`;
}

function write(path, content) {
  const file = join(OUT, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

// pos.ordr.ae and booking.ordr.ae are served from website/pos and website/booking.
const folder = (host) => (host === "main" ? "" : `${host}/`);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  write("index.html", homePage("en"));
  write("ar/index.html", homePage("ar"));
  for (const p of pages) {
    for (const lang of ["en", "ar"]) {
      const c = p[lang];
      if (c.title.length > 72) console.warn(`long title (${c.title.length}): ${c.title}`);
      if (c.description.length > 170) console.warn(`long description (${c.description.length}): ${p.slug} ${lang}`);
      write(`${folder(p.host)}${localPath(p, lang).slice(1)}index.html`, page(p, lang));
    }
  }
  for (const host of Object.keys(HOSTS)) {
    write(`${folder(host)}sitemap.xml`, sitemap(host));
    write(`${folder(host)}robots.txt`, `User-agent: *\nAllow: /\n\nSitemap: ${HOSTS[host]}/sitemap.xml\n`);
  }
  console.log(`wrote ${pages.length * 2 + 2} pages, sitemaps and robots.txt`);
}
