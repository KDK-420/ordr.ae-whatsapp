# ordr.ae product website

The public marketing site, in English and Arabic. `pos/` is served as pos.ordr.ae and `booking/` as
booking.ordr.ae; everything else is ordr.ae.
Static HTML, CSS and JavaScript with no dependencies. It is separate from the product, which lives
in `apps/`.

Run it locally:

    python3 -m http.server 3200 --directory website

Pushing a change here to `main` publishes it: `.github/workflows/website.yml` updates this folder on
the server, where Caddy serves it. Links to the product point at https://app.ordr.ae
(sign in, web chat demo, privacy policy).

Every page, `sitemap.xml` and `robots.txt` are generated. Edit `website-src/home.mjs` for the home
pages, `website-src/suite.mjs` for the ordr POS overview and its module pages (point of sale,
kitchen display, inventory, online ordering site, coffee shops) or `website-src/pages.mjs` for the
others, run `node website-src/build.mjs`, and commit the output. Run it after changing `assets/styles.css` or `assets/site.js` too, so pages pick up the new
file versions.

The phone on the home pages is a sample conversation in `assets/site.js`, in both languages. It
creates no real orders or bookings. Keep claims to what the product does today: see the "what is
mocked" section of docs/RUNBOOK.md before adding one.

The product screenshots in `assets/shots/` are real screens of the Daybreak Coffee demo
(`SEED_DEMO=coffee`), captured at twice the size and saved as WebP. Retake them when a screen
changes; a page names its pictures with `hero.img` and a section's `img`.

Each page carries its own `updated` date for the sitemap; set it when you change a page.

Visitor analytics are off until `ANALYTICS.plausibleDomain` is set in `website-src/build.mjs`.
With it set, every page loads Plausible and "Book a demo" clicks are counted as a goal.
