// Generates the SEO pages, sitemap and robots.txt into website/. Run after editing pages.mjs and commit
// the output: `node website-src/build.mjs`. The two home pages in website/ are hand-written.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pages } from "./pages.mjs";

const HOSTS = { main: "https://ordr.ae", pos: "https://pos.ordr.ae", booking: "https://booking.ordr.ae" };
const SITE = HOSTS.main;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "website");
const UPDATED = "2026-11-06";
const WHATSAPP = "https://wa.me/971509397420?text=Hi";
const FONTS = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Figtree:wght@400;500;600&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap";

const UI = {
  en: {
    dir: "ltr", home: "Home", nav: "Main", howItWorks: "How it works", industries: "Industries", team: "For your team", questions: "Questions",
    otherLang: "العربية", otherLangCode: "ar", tryIt: "Try it", demo: "Message our demo on WhatsApp", browser: "Try it in your browser",
    note: "Arabic and English. Nothing for your customers to install.", online: "online", faq: "Questions", faqTitle: "Good questions.",
    related: "Keep reading", more: "More", closing: "The fastest way to judge it is to message it.", demoShort: "Message our demo", talk: "Talk to us",
    posName: "ordr POS", bookingName: "ordr Booking", alsoFor: "Also for:", allIndustries: "See all industries",  privacy: "Privacy", signIn: "Sign in", footer: "© 2026 ordr.ae, by Kdk420 General Trading LLC, Dubai", crumbs: "Breadcrumb", exampleChat: "Example WhatsApp conversation",
  },
  ar: {
    dir: "rtl", home: "الرئيسية", nav: "القائمة الرئيسية", howItWorks: "كيف يعمل", industries: "القطاعات", team: "لفريقك", questions: "الأسئلة",
    otherLang: "English", otherLangCode: "en", tryIt: "جرّبه", demo: "راسل النسخة التجريبية عبر واتساب", browser: "جرّبه من المتصفح",
    note: "بالعربية والإنجليزية. لا يحتاج عملاؤك إلى تثبيت أي شيء.", online: "متصل", faq: "الأسئلة", faqTitle: "أسئلة في محلها.",
    related: "تابع القراءة", more: "المزيد", closing: "أسرع طريقة للحكم عليه أن تراسله.", demoShort: "راسل النسخة التجريبية", talk: "تحدث إلينا",
    posName: "ordr POS", bookingName: "ordr Booking", alsoFor: "ويناسب أيضاً:", allIndustries: "جميع القطاعات",  privacy: "الخصوصية", signIn: "تسجيل الدخول", footer: "© 2026 ordr.ae، من شركة Kdk420 General Trading LLC، دبي", crumbs: "مسار التنقل", exampleChat: "مثال على محادثة واتساب",
  },
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

function clock(start, minutes) {
  const [h, m] = start.split(":").map(Number);
  const total = (h * 60 + m + minutes) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function phone(chat, ui) {
  const lines = chat.lines.map(([me, line], i) =>
    `<div class="msg${me ? " me" : ""}">${text(line).replace(/\n/g, "<br>")}<time>${clock(chat.at, i)}</time></div>`).join("\n              ");
  return `<div class="demo">
          <div class="phone" role="img" aria-label="${ui.exampleChat}">
            <div class="phone-top">
              <span class="avatar" aria-hidden="true">${text(chat.name.charAt(0))}</span>
              <div><div class="phone-name">${text(chat.name)}</div><div class="phone-status">${ui.online}</div></div>
            </div>
            <div class="chat chat-static">
              ${lines}
            </div>
          </div>
        </div>`;
}

export function footerLinks(lang) {
  const ui = UI[lang];
  const list = (slugs) => slugs.map((slug) => `<li><a href="${urlOf(slug, lang)}">${byId(slug).label[lang]}</a></li>`).join("");
  return `<div class="footer-links">
        <div><h2>${ui.posName}</h2><ul>${list(["whatsapp-ordering-system", "restaurant-whatsapp-ordering", "grocery-whatsapp-ordering", "sell-on-whatsapp"])}</ul></div>
        <div><h2>${ui.bookingName}</h2><ul>${list(["whatsapp-booking-system", "salon-booking-software", "padel-court-booking-system", "hotel-whatsapp-booking"])}</ul></div>
        <div><h2>${ui.more}</h2><ul>${list(["industries", "whatsapp-chatbot", "guides/whatsapp-business-api-uae"])}</ul></div>
      </div>`;
}

function page(p, lang) {
  const ui = UI[lang];
  const c = p[lang];
  const other = ui.otherLangCode;
  const url = urlOf(p.slug, lang);
  const card = (slug) => {
    const r = byId(slug);
    return `<article class="card"><h3><a href="${urlOf(slug, lang)}">${r.label[lang]}</a></h3><p>${attr(r[lang].description)}</p></article>`;
  };
  const related = (p.en.related ?? []).map(card).join("\n          ");
  const children = (p.children ?? []).map(card).join("\n          ");
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
  const sections = c.sections.map((s) => `<h2>${s.h}</h2>
          <p>${links(s.p, lang)}</p>${s.ticks ? `\n          <ul class="ticks">${s.ticks.map((t) => `<li>${t}</li>`).join("")}</ul>` : ""}`).join("\n          ");
  const faq = c.faq.map(([q, a]) => `<details><summary>${q}</summary><p>${links(a, lang)}</p></details>`).join("\n          ");

  return `<!doctype html>
<html lang="${lang}" dir="${ui.dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${c.title}</title>
  <meta name="description" content="${attr(c.description)}">
  <meta name="theme-color" content="#0e3b34">
  <link rel="canonical" href="${url}">
  <link rel="alternate" hreflang="en" href="${urlOf(p.slug, "en")}">
  <link rel="alternate" hreflang="ar" href="${urlOf(p.slug, "ar")}">
  <link rel="alternate" hreflang="x-default" href="${urlOf(p.slug, "en")}">
  <meta property="og:title" content="${attr(c.title)}">
  <meta property="og:description" content="${attr(c.description)}">
  <meta property="og:type" content="${p.guide ? "article" : "website"}">
  <meta property="og:url" content="${url}">
  <meta property="og:site_name" content="ordr.ae">
  <meta property="og:locale" content="${lang === "ar" ? "ar_AE" : "en_AE"}">
  <meta property="og:image" content="${SITE}/assets/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${FONTS}">
  <link rel="stylesheet" href="/assets/styles.css">
  <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script>
</head>
<body>
  <header class="site-header">
    <div class="wrap">
      <a class="logo" href="${homeOf(lang)}" dir="ltr">ordr<span>.ae</span></a>
      <nav class="nav" aria-label="${ui.nav}">
        <a href="${urlOf("whatsapp-ordering-system", lang)}">${ui.posName}</a>
        <a href="${urlOf("whatsapp-booking-system", lang)}">${ui.bookingName}</a>
        <a href="${urlOf("industries", lang)}">${ui.industries}</a>
        <a href="${homeOf(lang)}#faq">${ui.questions}</a>
      </nav>
      <div class="header-actions">
        <a class="lang" href="${urlOf(p.slug, other)}" lang="${other}" hreflang="${other}">${ui.otherLang}</a>
        <a class="button button-primary" href="${WHATSAPP}" target="_blank" rel="noopener">${ui.tryIt}</a>
      </div>
    </div>
  </header>

  <main id="top">
    <section class="hero hero-sub${c.chat ? "" : " hero-text"}">
      <div class="wrap">
        <div>
          <nav class="crumbs" aria-label="${ui.crumbs}"><a href="${homeOf(lang)}">${ui.home}</a> <span aria-hidden="true">/</span> ${parent ? `<a href="${urlOf(parent.slug, lang)}">${parent.label[lang]}</a> <span aria-hidden="true">/</span> ` : ""}<span aria-current="page">${p.label[lang]}</span></nav>
          <h1>${c.h1}</h1>
          <p class="hero-lead">${c.lead}</p>
          <div class="hero-actions">
            <a class="button button-primary" href="${WHATSAPP}" target="_blank" rel="noopener">${ui.demo}</a>
            <a class="button button-ghost" href="https://app.ordr.ae/chat/demo-salon">${ui.browser}</a>
          </div>
          <p class="hero-note">${ui.note}</p>
        </div>
        ${c.chat ? phone(c.chat, ui) : ""}
      </div>
    </section>

    ${children ? `<section class="section band-soft">
      <div class="wrap">
        <div class="section-head"><span class="pill">${ui.industries}</span><h2>${c.childrenTitle}</h2></div>
        <div class="grid">
          ${children}
        </div>
        <p class="also"><strong>${ui.alsoFor}</strong> ${c.also} <a href="${urlOf("industries", lang)}">${ui.allIndustries}</a></p>
      </div>
    </section>

    ` : ""}<section class="section">
      <div class="wrap">
        <div class="article">
          ${sections}
        </div>
      </div>
    </section>

    <section class="section band-soft" id="faq">
      <div class="wrap">
        <div class="section-head"><span class="pill">${ui.faq}</span><h2>${ui.faqTitle}</h2></div>
        <div class="faq">
          ${faq}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="wrap">
        <div class="section-head"><span class="pill">${ui.related}</span></div>
        <div class="grid">
          ${related}
        </div>
      </div>
    </section>

    <section class="closing">
      <div class="wrap">
        <h2>${ui.closing}</h2>
        <div class="closing-actions">
          <a class="button button-dark" href="${WHATSAPP}" target="_blank" rel="noopener">${ui.demoShort}</a>
          <a class="button button-ghost" href="mailto:hello@ordr.ae?subject=ordr.ae%20demo">${ui.talk}</a>
        </div>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="wrap">
      ${footerLinks(lang)}
      <div class="footer-base">
        <span>${ui.footer}</span>
        <nav aria-label="Footer">
          <a href="https://app.ordr.ae/privacy">${ui.privacy}</a>
          <a href="https://app.ordr.ae/login">${ui.signIn}</a>
          <a href="mailto:hello@ordr.ae" dir="ltr">hello@ordr.ae</a>
        </nav>
      </div>
    </div>
  </footer>
</body>
</html>
`;
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
  console.log(`wrote ${pages.length * 2} pages, sitemaps and robots.txt`);
}
