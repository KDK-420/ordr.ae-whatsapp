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
pages or `website-src/pages.mjs` for the others, run `node website-src/build.mjs`, and commit the
output. Run it after changing `assets/styles.css` or `assets/site.js` too, so pages pick up the new
file versions.

The phone on the home pages is a sample conversation in `assets/site.js`, in both languages. It
creates no real orders or bookings. Keep claims to what the product does today: see the "what is
mocked" section of docs/RUNBOOK.md before adding one.
