# Website and SEO plan

Status: phase 1 is built on branch `claude/restaurant-suite`, 2026-11-17. It is not published:
the website goes live when the branch reaches `main`, and the store changes with the next deploy.
Section 0 says what phase 1 delivered. Sections 1 to 6 are the plan as written.

## 0. Phase 1: what was built

Website (`website/`, generated from `website-src/`):

| Item | Result |
|---|---|
| ordr POS overview | Rewritten around the five modules, with a hero screenshot, module cards and a feature row per module. |
| New pages, English and Arabic | Point of sale, Kitchen display, Inventory, Online ordering site, Coffee shops. Ten new addresses on `pos.ordr.ae`. |
| Updated pages | Home (both languages), Restaurants, Industries. Every answer that said ordr POS "doesn't run a till" is corrected. |
| Product pictures | 14 real screenshots of the Daybreak Coffee demo in `website/assets/shots/`, about 760 KB together. |
| Honest limits | Each module page says what it does not do yet: printing, offline mode, online card payment, custom domains, Arabic store screens. |
| Structured data | Software data on the module pages; the names "ordr" and "اوردر" in the organisation data. |
| Sitemaps | Each page carries its own last-changed date. `pos.ordr.ae` now lists 18 addresses. |
| Speed | Fonts no longer block the first paint; the share image is half the size; assets get a 30 day cache lifetime in Caddy. |
| Measurement | "Book a demo" clicks are reported as a goal once an analytics site id is set. Off until then. |

Stores (`<slug>.ordr.ae`):

| Item | Result |
|---|---|
| Search switch | A store is hidden from search engines until the operator ticks "Show this restaurant's site in Google" on the restaurant in Admin. Demo stores stay hidden. |
| Canonical address | Store pages name `https://<slug>.ordr.ae/...` as their address, also when reached under `/site/<slug>` on our own host. |
| robots.txt per host | A restaurant's host keeps crawlers out of `/admin`, `/checkout` and order pages. Our own host keeps them out of the signed-in app. |
| Sitemap | `https://<slug>.ordr.ae/sitemap.xml` lists the front page and the menu, for listed stores only. |
| Restaurant and menu data | The front page describes the restaurant (name, address, phone, where to order); the menu page lists every section, item and price. |

Not done in phase 1, and why:

- **Analytics is not switched on.** It needs an account. Set `ANALYTICS.plausibleDomain` in
  `website-src/build.mjs`, or say which tool you use.
- **Separate Search Console properties** for the three hosts are created in Search Console, not
  in code.
- **Social profiles** are not in the organisation data, because none were supplied.
- **The three hosts were not merged.** That is decision 1 in section 6 and still open.
- **No prices** anywhere. Decision 2.
- **The one-page sites of salons, courts and resorts** were left as they are: no switch, no
  sitemap. They were indexable before and still are.

The suite pages link "See a live store" to `https://daybreak.ordr.ae`, the demo restaurant in
production. If that restaurant is renamed or removed, change `STORE_DEMO` in
`website-src/build.mjs`.

It answers two requests: the website does not show the restaurant suite (online store, till,
kitchen display, inventory), and the Search Console numbers are low. They are one job. The
pages we need for the new features are the same pages that give search engines something to
rank.

## 1. Where we stand

### What Search Console shows

Three months, web search, for the whole `ordr.ae` domain:

| Query | Clicks | Impressions | Relevant to us |
|---|---|---|---|
| cyberbeast ev services abu dhabi | 0 | 29 | No |
| whatsapp ordering for restaurants | 0 | 7 | Yes |
| ordr | 0 | 6 | Brand |
| food ordering system | 0 | 6 | Yes |
| tesla repair abu dhabi | 0 | 5 | No |
| padel booking | 0 | 5 | Partly |
| padel booking app | 0 | 4 | Partly |
| whatsapp ordering system for restaurants | 0 | 4 | Yes |
| اوردر | 0 | 3 | Brand |
| ai powered whatsapp chatbot dubai | 0 | 3 | Yes |

What this means:

- **The site is not ranking yet.** A handful of impressions and no clicks in three months means
  the pages are shown rarely and low on the page. That is normal for a new site with few pages
  and no links from other sites. It is not a penalty and nothing is broken.
- **Google matches the right pages to the right topics.** WhatsApp ordering, food ordering and
  the chatbot all appear. The problem is position and volume, not relevance.
- **The top query is not ours.** The Search Console property covers every address under
  `ordr.ae`, including customers' own pages. The two car-service queries almost certainly belong
  to a customer page on a subdomain. I could not confirm which one from outside.
- **"Padel booking" is mostly players, not clubs.** People typing that want to book a court.
  The buyers we want type "padel court booking software".
- The screenshot has no position or page columns. Those two would tell us how far from page one
  each query is.

### What the audit of the live site found

Already right:

- HTTP goes to HTTPS, `www` goes to `ordr.ae`, old addresses redirect to the new product sites.
- Every page has a title and description of the right length, a canonical address, and English
  and Arabic versions that point at each other.
- A sitemap and robots file on each of the three hosts.
- FAQ and breadcrumb structured data on every product page.

Problems, most important first:

1. **The pages describe an older product.** `pos.ordr.ae` still answers "Is it a full
   point-of-sale system?" with "Not yet … it doesn't run a till". There is no page about the
   till, the kitchen display, inventory or the ordering website.
2. **There is very little to rank.** 18 pages per language and one guide. Sites that rank for
   "restaurant POS UAE" publish dozens of pages on it.
3. **No product pictures.** Not one image on any page. Visitors and search engines see claims,
   not the product.
4. **Authority is split three ways.** `ordr.ae`, `pos.ordr.ae` and `booking.ordr.ae` are three
   sites to a search engine. Each starts from nothing, and a link earned by one helps the
   others little.
5. **Demo stores can be indexed.** `daybreak.ordr.ae` and `daybreak-coffee.ordr.ae` are two
   copies of the same demo with stock photos, open to search engines, with no canonical address.
   They land in the same Search Console property and look like duplicate thin content.
6. **Real customer stores get no SEO help.** No sitemap, no canonical address, no restaurant or
   menu structured data. A restaurant's own ordering site should rank for its own name.
7. **Speed.** The server answers quickly but is slow to reach: about 0.25 s per round trip and
   about 0.8 s to the first byte of the home page from the test location. The site's style
   sheet and script are sent with no cache lifetime, the share image is 390 KB, and fonts load
   from Google before the page can draw.
8. **Nothing is measured.** No analytics and no tracking of "Book a demo" clicks, so we cannot
   tell which page or query brings a lead.
9. **Missing trust pages.** No pricing, no about or contact page, no customer stories.
10. **Brand search is weak.** The home page headline has no words people search for, and the
    organisation data does not include the Arabic name "اوردر" or any social profiles.

### The competition

From a look at who answers these searches today. These are vendor pages, so their claims are
their own.

| Topic | Who shows up | How hard |
|---|---|---|
| Restaurant POS, UAE | Neotech, PosBytz, Petpooja, Epos Now, QueueBuster, Ezi-Pos | Hard. Established vendors with many pages. |
| WhatsApp ordering for restaurants | Cravin Food, Ramzi, Go4whatsup, LetsBot | Medium. Small, new vendors. We already get impressions. |
| Kitchen display system, Dubai | Royex, Truebays, Restroworks, UpMenu | Medium. Few local product pages. |
| Commission-free ordering website | Deonde, Ramzi, Cloudix, PosBytz | Medium. |
| Padel court booking software | Book and Go, Courtzap | Medium. One focused local vendor. |

**No search volumes yet.** The connected Semrush account has no API units left, so this plan
has no monthly search numbers or difficulty scores. Either top up at
https://www.semrush.com/mcp-access or send a Google Keyword Planner export, and the keyword
table in section 3 gets real numbers.

## 2. Strategy

Do not fight for "restaurant POS UAE" first. Win the narrower searches where we are different
and the field is thin, then use those pages and their links to climb the broad ones.

Our difference, in one line: **one system where WhatsApp, the ordering website, the till, the
kitchen screen and stock are the same order.** Nobody in the lists above sells that to a small
UAE restaurant.

Three rules for every page:

- **Say only what the product does today.** No offline till, receipt printing, online card
  payment or delivery-app integration until they exist. `docs/MODULES_PLAN.md` section 0 is the
  list.
- **Show the product.** Real screenshots of the store, till, kitchen display and stock list.
- **One search intent per page**, in English and in Arabic written for Arabic readers, not
  translated word for word.

## 3. Keyword map

Each row is one page. "New" pages do not exist yet.

| Page | Main searches it answers | State |
|---|---|---|
| ordr.ae home | ordr, اوردر, AI WhatsApp assistant UAE | Update |
| ordr POS overview | restaurant management system UAE, POS with WhatsApp ordering | Rewrite |
| Restaurants and cafés | WhatsApp ordering system for restaurants, food ordering system | Update |
| Coffee shops | coffee shop POS system UAE, café POS Dubai | New |
| Cloud kitchens | cloud kitchen POS UAE, cloud kitchen ordering system | New |
| Point of sale | restaurant POS system UAE, restaurant billing software | New |
| Kitchen display | kitchen display system Dubai, KDS for restaurants | New |
| Inventory | restaurant inventory management software UAE, recipe costing | New |
| Online ordering site | commission-free online ordering system UAE, own ordering website for restaurants | New |
| Padel | padel court booking software UAE, padel club management | Update |
| Guide: your own ordering channel | how to take restaurant orders without aggregator commission | New |
| Guide: kitchen display | what is a kitchen display system, KDS vs kitchen printer | New |
| Guide: stock and recipes | how to track restaurant inventory, cost of a cup of coffee | New |
| Pricing | ordr pricing, restaurant POS price UAE | New, needs a decision |

Arabic targets to research once volumes are available: نظام نقاط البيع للمطاعم, نظام طلبات
واتساب للمطاعم, شاشة المطبخ, برنامج إدارة مخزون المطاعم, برنامج حجز ملاعب بادل.

## 4. The work, in three phases

### Phase 1: make the site match the product (about one week of work, I can build it)

Content:

- Rewrite the ordr POS overview around the five modules, with screenshots of each.
- Add the four module pages: point of sale, kitchen display, inventory, online ordering site.
- Update the restaurants page and the home page: product card, numbers strip, questions.
- Add a coffee shop page. The demo is a coffee shop, so the screenshots fit.
- Correct every answer that now undersells or oversells the product.

Technical:

- Hide demo restaurants from search engines, with a per-restaurant switch the operator controls.
- Give real customer stores a sitemap, a canonical address and restaurant and menu structured
  data.
- Keep search engines out of `/admin`, `/checkout` and order tracking pages.
- Cache lifetimes for style sheets, scripts and images; a smaller share image; fonts that do
  not block the first paint.
- Product structured data on the module pages, and the Arabic brand name and social profiles in
  the organisation data.

Measurement:

- Privacy-friendly analytics with a "Book a demo" click as the goal.
- Separate Search Console properties for `ordr.ae`, `pos.ordr.ae` and `booking.ordr.ae`, so
  customer pages stop mixing into the numbers. This is done in Search Console, not in code.

### Phase 2: depth (weeks 2 to 4)

- The three guides in the keyword map, each answering one real question with our own
  screenshots and numbers.
- Cloud kitchen page.
- Pricing page, once prices are decided.
- About and contact page with the company's legal name and address.
- Arabic versions written as originals.

### Phase 3: authority (ongoing, mostly needs you)

Pages alone will not rank a new domain. Other sites have to point at it.

- Google Business Profile for the company in Dubai.
- Listings on Capterra UAE, G2 and Product Hunt, where the competitors above are listed.
- One or two customer stories with a real restaurant's name, numbers and a link back.
- A mention or link from each customer's own site and social profiles.
- Local press or founder posts when a notable customer goes live.

## 5. How we will know it is working

Review once a month from Search Console and analytics:

| Measure | Today | Good sign in 3 months |
|---|---|---|
| Pages indexed across the three hosts | not checked | all published pages |
| Queries with impressions | about 10 | a few hundred |
| Average position for the 15 target searches | unknown | page two or better on the narrow ones |
| Clicks from search per month | 0 | first steady trickle |
| "Book a demo" clicks from search visitors | not tracked | tracked and above zero |

An honest expectation: on a new domain the narrow searches can reach page one in three to six
months if phases 1 to 3 all happen. The broad ones, such as "restaurant POS UAE", take longer
and depend mostly on phase 3. Nobody can promise a position.

## 6. Decisions needed

1. **One site or three?** Moving the product sites to `ordr.ae/pos/` and `ordr.ae/booking/`
   would pool all authority in one domain, with redirects from the current addresses. The cost
   is undoing a recent move and losing the short product addresses. Recommended: pool them,
   now, while there is almost no ranking to lose.
2. **Public prices or "contact us"?** A pricing page ranks and qualifies leads, but only with
   real numbers.
3. **What "ordr POS" means now.** Recommended: ordr POS is the whole restaurant suite, and the
   five modules are named inside it.
4. **Hide demo restaurants from search?** Recommended: yes.
5. **Data.** Either Semrush units or a Keyword Planner export, plus a Search Console export with
   the position and page columns.
6. **Customers.** Which restaurants may be named in a customer story.
