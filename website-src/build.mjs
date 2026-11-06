// Generates the SEO pages, sitemap and robots.txt into website/. Run after editing pages.mjs and commit
// the output: `node website-src/build.mjs`. The two home pages in website/ are hand-written.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pages } from "./pages.mjs";

const SITE = "https://ordr.ae";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "website");
const UPDATED = "2026-11-06";
const WHATSAPP = "https://wa.me/971509397420?text=Hi";
const FONTS = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Figtree:wght@400;500;600&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap";

const UI = {
  en: {
    dir: "ltr", home: "Home", nav: "Main", howItWorks: "How it works", industries: "Industries", team: "For your team", questions: "Questions",
    otherLang: "العربية", otherLangCode: "ar", tryIt: "Try it", demo: "Message our demo on WhatsApp", browser: "Try it in your browser",
    note: "Arabic and English. Nothing for your customers to install.", online: "online", faq: "Questions", faqTitle: "Good questions.",
    related: "Keep reading", more: "Read more", closing: "The fastest way to judge it is to message it.", demoShort: "Message our demo", talk: "Talk to us",
    solutions: "Solutions", guides: "Guides", company: "ordr.ae", privacy: "Privacy", signIn: "Sign in", footer: "© 2026 ordr.ae, by Kdk420 General Trading LLC, Dubai", crumbs: "Breadcrumb", exampleChat: "Example WhatsApp conversation",
  },
  ar: {
    dir: "rtl", home: "الرئيسية", nav: "القائمة الرئيسية", howItWorks: "كيف يعمل", industries: "القطاعات", team: "لفريقك", questions: "الأسئلة",
    otherLang: "English", otherLangCode: "en", tryIt: "جرّبه", demo: "راسل النسخة التجريبية عبر واتساب", browser: "جرّبه من المتصفح",
    note: "بالعربية والإنجليزية. لا يحتاج عملاؤك إلى تثبيت أي شيء.", online: "متصل", faq: "الأسئلة", faqTitle: "أسئلة في محلها.",
    related: "تابع القراءة", more: "اقرأ المزيد", closing: "أسرع طريقة للحكم عليه أن تراسله.", demoShort: "راسل النسخة التجريبية", talk: "تحدث إلينا",
    solutions: "الحلول", guides: "الأدلة", company: "ordr.ae", privacy: "الخصوصية", signIn: "تسجيل الدخول", footer: "© 2026 ordr.ae، من شركة Kdk420 General Trading LLC، دبي", crumbs: "مسار التنقل", exampleChat: "مثال على محادثة واتساب",
  },
};

const pathOf = (slug, lang) => `${lang === "ar" ? "/ar" : ""}/${slug}/`;
const homeOf = (lang) => (lang === "ar" ? "/ar/" : "/");
const links = (text, lang) => text.replace(/\{\{([^}]+)\}\}/g, (_, slug) => {
  if (!pages.some((p) => p.slug === slug)) throw new Error(`unknown page in link: ${slug}`);
  return pathOf(slug, lang);
});
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
  const list = (items) => items.map((p) => `<li><a href="${pathOf(p.slug, lang)}">${p.label[lang]}</a></li>`).join("");
  return `<div class="footer-links">
        <div><h2>${ui.solutions}</h2><ul>${list(pages.filter((p) => !p.guide))}</ul></div>
        <div><h2>${ui.guides}</h2><ul>${list(pages.filter((p) => p.guide))}</ul></div>
      </div>`;
}

function page(p, lang) {
  const ui = UI[lang];
  const c = p[lang];
  const other = ui.otherLangCode;
  const url = SITE + pathOf(p.slug, lang);
  const related = (p.en.related ?? []).map((slug) => {
    const r = pages.find((x) => x.slug === slug);
    return `<article class="card"><h3><a href="${pathOf(slug, lang)}">${r.label[lang]}</a></h3><p>${attr(r[lang].description)}</p></article>`;
  }).join("\n          ");
  const breadcrumb = [
    { name: ui.home, item: SITE + homeOf(lang) },
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
  <link rel="alternate" hreflang="en" href="${SITE}${pathOf(p.slug, "en")}">
  <link rel="alternate" hreflang="ar" href="${SITE}${pathOf(p.slug, "ar")}">
  <link rel="alternate" hreflang="x-default" href="${SITE}${pathOf(p.slug, "en")}">
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
        <a href="${homeOf(lang)}#day">${ui.howItWorks}</a>
        <a href="${homeOf(lang)}#industries">${ui.industries}</a>
        <a href="${homeOf(lang)}#team">${ui.team}</a>
        <a href="${homeOf(lang)}#faq">${ui.questions}</a>
      </nav>
      <div class="header-actions">
        <a class="lang" href="${pathOf(p.slug, other)}" lang="${other}" hreflang="${other}">${ui.otherLang}</a>
        <a class="button button-primary" href="${WHATSAPP}" target="_blank" rel="noopener">${ui.tryIt}</a>
      </div>
    </div>
  </header>

  <main id="top">
    <section class="hero hero-sub${c.chat ? "" : " hero-text"}">
      <div class="wrap">
        <div>
          <nav class="crumbs" aria-label="${ui.crumbs}"><a href="${homeOf(lang)}">${ui.home}</a> <span aria-hidden="true">/</span> <span aria-current="page">${p.label[lang]}</span></nav>
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

    <section class="section">
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

function sitemap() {
  const entry = (en, ar, priority) => [en, ar].map((loc) => `  <url>
    <loc>${SITE}${loc}</loc>
    <lastmod>${UPDATED}</lastmod>
    <priority>${priority}</priority>
    <xhtml:link rel="alternate" hreflang="en" href="${SITE}${en}"/>
    <xhtml:link rel="alternate" hreflang="ar" href="${SITE}${ar}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${en}"/>
  </url>`).join("\n");
  const urls = [entry("/", "/ar/", "1.0"), ...pages.map((p) => entry(pathOf(p.slug, "en"), pathOf(p.slug, "ar"), "0.8"))];
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const p of pages) {
    for (const lang of ["en", "ar"]) {
      const c = p[lang];
      if (c.title.length > 72) console.warn(`long title (${c.title.length}): ${c.title}`);
      if (c.description.length > 170) console.warn(`long description (${c.description.length}): ${p.slug} ${lang}`);
      write(`${pathOf(p.slug, lang).slice(1)}index.html`, page(p, lang));
    }
  }
  write("sitemap.xml", sitemap());
  write("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
  console.log(`wrote ${pages.length * 2} pages, sitemap.xml and robots.txt`);
}
