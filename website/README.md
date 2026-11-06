# ordr.ae product website

The public marketing site for ordr.ae, in English (`index.html`) and Arabic (`ar/index.html`).
Plain HTML, CSS and JavaScript: no build step, no dependencies. It is separate from the product,
which lives in `apps/`.

Run it locally:

    python3 -m http.server 3200 --directory website

Pushing a change here to `main` publishes it: `.github/workflows/website.yml` updates this folder on
the server, where Caddy serves it as ordr.ae. Links to the product point at https://app.ordr.ae
(sign in, web chat demo, privacy policy).

The two home pages are hand-written. The other pages, `sitemap.xml` and `robots.txt` are generated:
edit `website-src/pages.mjs`, run `node website-src/build.mjs`, and commit the output.

The hero conversations are in `assets/site.js`, with the first one also in each HTML file so the
page reads fully without JavaScript. Keep claims to what the product does today: see the
"what is mocked" section of docs/RUNBOOK.md before adding one.
