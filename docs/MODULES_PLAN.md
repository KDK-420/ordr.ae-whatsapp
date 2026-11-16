# Restaurant suite: modules plan

Status: agreed direction, 2026-11-16. Updated the same day with countable supplies, party orders,
and addresses: one host per restaurant with staff under `/admin`, and flexible custom domains.
Nothing here is built yet. Mockups are being designed in parallel; the screen lists in section 6
are written for that.

Scope: restaurants only, the product the website calls ordr POS. Salon, sports, retail and resort
tenants (ordr Booking and shops) keep working exactly as they do today and are not touched by this
plan.

## 1. What we are building

Five modules a restaurant can switch on independently, on top of one shared core.

| Module | Primary experience | Stands alone? |
| --- | --- | --- |
| Storefront (eCommerce) | Mobile-first ordering site: menu with customisation, cart, checkout, order tracking | Yes |
| POS | Fast touchscreen checkout for cashiers: dine-in, takeaway, walk-in | Yes |
| KDS | Real-time kitchen tickets with timers, priority and status | Needs one order source (Storefront, POS or WhatsApp) |
| Inventory | Stock of ingredients and countables such as cups and packaging, recipe-based deduction, purchasing, wastage, low-stock alerts | Needs the menu; useful once POS or Storefront feeds it sales |
| WhatsApp | The assistant that takes orders and answers customers on WhatsApp (today's product) | Yes |

Decisions already taken:

- One application, one database. Modules are boundaries in packaging and code, not separate
  services.
- Offline POS is a later phase. POS v1 needs a connection.
- Payments are built against the existing `PaymentProvider` port with the mock adapter; the real
  gateway and card terminal are chosen later and plug in behind the port.
- One host per restaurant: the storefront on `<slug>.ordr.ae` and the staff apps under
  `/admin` on the same host. Restaurants may add their own domains at any time and use either
  or both (section 3.6).

## 2. Architecture rules

1. **Core is always on.** Tenant, branches, menu, orders, customers, staff, payments.
2. **Modules are entitlements on the tenant.** `Tenant.modules` (a list such as
   `["pos", "kds", "whatsapp"]`) gates each module's screens, API routes and background handlers.
   Today the list of dashboard sections comes from the vertical blueprint (`dashboardModules`);
   it moves to the tenant so two restaurants can differ. The blueprint keeps supplying defaults.
3. **Modules never call each other.** They read and write the core, and they react to domain
   events from the outbox (`order.placed`, `order.item_status_changed`, ...). KDS listens for
   orders. Inventory listens for sold lines. WhatsApp listens for status changes and notifies
   the customer, which it already does through `OrderNotifier`.
4. **A tenant works with no WhatsApp number.** Eight code paths currently stop or skip when a
   tenant has no active channel; each becomes "skip the WhatsApp side effect, keep going".
5. **The assistant is a capability, not a module.** WhatsApp and Storefront chat both use it.
6. **Every write to stock or money is a ledger row**, never an in-place overwrite, so anything
   can be reconciled.

Code layout (inside the existing monorepo):

```
apps/api/src/core/         branches, order lines, realtime stream, entitlements, roles
apps/api/src/modules/kds/
apps/api/src/modules/pos/
apps/api/src/modules/storefront/
apps/api/src/modules/inventory/
apps/api/src/modules/whatsapp/   (today's conversation, webhook, inbox code moves here last)
apps/dashboard/app/site/[slug]/...                 public storefront (extends today's customer page)
apps/dashboard/app/site/[slug]/admin/...           back office, /pos, /kds, /inventory on the tenant's host
```

## 3. Core changes (Phase 0)

These four come first. Every module depends on them.

### 3.1 Module entitlements

- `Tenant.modules Json` (string list). `GET /merchant/me` returns it; the dashboard nav already
  filters on `tenant.modules`.
- A `@RequiresModule("kds")` guard on controllers; event handlers check the same list.
- Platform admin console: toggle modules per tenant.

### 3.2 Branches

A restaurant has one or more branches. Stock, tables, kitchen screens, shifts and orders belong
to a branch.

```
Branch          id, tenantId, name, address, mapsUrl, phone, timezone, hours, isActive, sortOrder
Order.branchId  required for restaurant orders going forward
```

`Property` (built for resorts) is the same concept. Plan: introduce `Branch` for restaurants now
and fold `Property` into it later, once the resort fields that do not apply (check-in times) are
settled; no migration of resort data in this plan. A single-branch restaurant gets one branch
created automatically and never sees a branch picker.

Menu: one menu per tenant, with per-branch availability (`BranchOffering`: `isAvailable`,
optional price override). This is what "86 an item" switches.

### 3.3 Order lines as first-class items

Today an order moves through states as a whole and its lines are passive. Kitchens work on lines.

```
OrderItem  + status        queued | preparing | ready | served | voided
           + stationId     where it is prepared
           + course        1, 2, 3 (dine-in firing)
           + firedAt, startedAt, readyAt, servedAt
           + voidReason, addedBy
Order      + branchId, tableId?, guests?, tabStatus (open | closed), shiftId?, discountMinor,
             tipMinor, serviceChargeMinor
```

Rules:

- The order's status is derived from its lines where the blueprint says so (all lines ready
  means the order is ready), so WhatsApp and storefront customers keep getting the same status
  messages they get today.
- Lines can be added to an open order (dine-in tabs). Each addition is an event.
- New events: `order.item_added`, `order.item_status_changed`, `order.item_voided`,
  `order.fired`, `order.paid`, `order.refunded`.

### 3.4 Real-time stream

Every screen polls today (4 to 15 seconds). Kitchen and POS need push.

- `GET /merchant/stream` (server-sent events), scoped to tenant and branch, fed from the outbox
  so there is one source of truth. Clients resume with `Last-Event-ID`; on reconnect they refetch
  a snapshot and continue.
- A public variant for the storefront tracking page, scoped to one order by an unguessable token.
- Polling stays as the fallback path, so a blocked stream degrades instead of breaking.

### 3.5 Roles and devices

- Roles: `owner`, `manager`, `cashier`, `kitchen`, `staff` (today: owner, staff). Permissions per
  role are a fixed table at first (who can void, discount, refund, close a shift, edit stock).
- PIN login on shared devices: a device is paired once by a manager, then staff unlock it with a
  4 to 6 digit PIN. Every action records who did it.
- Device sessions for wall screens: a KDS screen is paired to a branch and station and stays
  signed in.

### 3.6 Addresses and domains

What exists today (do not rebuild):

- `*.ordr.ae` points at the server. `ordr.ae`, `pos.ordr.ae` and `booking.ordr.ae` are the
  product website; `app.ordr.ae` is the staff app and API.
- Every tenant already has a public page on `<slug>.ordr.ae`, published from Settings › Website.
  `apps/dashboard/proxy.ts` maps the host to `/site/<slug>`, and Caddy issues a certificate per
  host on first visit after `GET /v1/sites/tls-check` confirms the site is published.
- Reserved subdomains: `app`, `www`, `api`, `admin`, `mail`, `staging`, `demo`, `pos`, `booking`.

Decision: **one host per restaurant, staff under `/admin`.** Everything under `/admin` is staff
and needs a login; everything else is public. Example for Daydream Coffee:

| Address | What |
| --- | --- |
| `daydream.ordr.ae` | Storefront: menu, cart, checkout |
| `daydream.ordr.ae/t/<tableCode>` | Table QR |
| `daydream.ordr.ae/o/<token>` | Order tracking |
| `daydream.ordr.ae/party` | Party request |
| `daydream.ordr.ae/chat` | Web chat (exists) |
| `daydream.ordr.ae/admin` | Back office: menu, reports, settings, inbox |
| `daydream.ordr.ae/admin/pos` | Cashier app |
| `daydream.ordr.ae/admin/kds` | Kitchen screens |
| `daydream.ordr.ae/admin/inventory` | Stock |

Why paths and not `pos.daydream.ordr.ae`: one DNS record and one certificate per restaurant,
which works with what is deployed and stays simple when a customer brings a domain whose DNS we
do not control.

**Domains are flexible.** A restaurant is never forced to pick one arrangement.

```
TenantDomain  id, tenantId, host, kind (platform | custom), status (pending | verified | failed),
              isPrimary, redirectToPrimary, verifiedAt, createdAt
```

- Every restaurant always has `<slug>.ordr.ae` (kind `platform`). It is created with the tenant
  and never removed, so there is always one address that works.
- A restaurant may add any number of its own domains (`daydreamcoffee.ae`,
  `order.daydreamcoffee.ae`). Each needs one DNS record pointing at us; we verify it, then the
  existing on-demand certificate check allows it.
- **Every verified host serves everything**: the storefront and `/admin` with all the modules
  the restaurant has. `daydreamcoffee.ae/admin/pos` and `daydream.ordr.ae/admin/pos` are the same
  app. Customers and staff can use either.
- One host is **primary**, chosen by the owner; the default is the ordr.ae address. The primary
  is what we put in links we generate (WhatsApp messages, receipts, QR codes, payment and
  tracking links) and in the canonical tag, so search engines see one menu, not copies.
- Other hosts keep working. Per host the owner can switch on "send visitors to the primary
  address", which redirects storefront pages only. `/admin` never redirects to another host,
  because staff sessions and paired devices belong to the address they were set up on.
- Removing a custom domain: links fall back to the next primary; the owner is warned if devices
  are paired on that host, since they will need pairing again. The pairing screen suggests the
  ordr.ae address for wall screens and tills because it is permanent, without enforcing it.

Rules that hold on every host:

- One resolver turns a host into a tenant (platform subdomain or `TenantDomain` lookup, cached);
  every public page, public API and `/admin` route uses it. A staff session is valid only for
  the tenant its host resolves to.
- `/admin` is a reserved path no storefront page can use. `/merchant/*` and `/v1/*` already
  reach the API on any host.
- The storefront and the staff apps share a browser origin, so: the staff session cookie is
  limited to `/admin` and the staff API, every staff write carries a second token, and the
  storefront runs under a strict content security policy with only our own scripts.
- Each staff app is installable from its own path (own icon, full screen, own offline cache
  scope), so a kitchen tablet opens straight into the KDS.
- `app.ordr.ae` stays as the universal door: staff who forget their address sign in there and are
  passed to their restaurant's `/admin` with a one-time handoff. Platform admin lives there, and
  the salon, sports, retail and resort tenants keep using it unchanged.
- `pos.ordr.ae` stays the marketing site for the product.
- Multi-branch restaurants keep one address; branch is chosen inside the apps, and table QR
  codes carry it.
- A slug change keeps the old slug as a redirect (`TenantSlugHistory`), because printed QR codes
  outlive renames. Today a rename would break old links.
- The reserved subdomain list grows with `kds`, `inventory`, `store`, `shop`, `status`, `help`,
  `docs`, `cdn` before restaurants pick names freely.

### 3.7 Hardening that rides along

- Database row-level security by `tenantId` before money and stock tables are added. Isolation is
  enforced only in application code today.
- Audit trail for voids, discounts, refunds and stock adjustments (who, when, why).

## 4. Modules

### 4.1 KDS (Phase 1)

First module: smallest step from the existing order board, and it improves live WhatsApp orders
immediately.

```
Station   id, tenantId, branchId, name (Grill, Fry, Cold, Bar, Expo), sortOrder
Offering.stationId (default station per menu item; category default as fallback)
```

- Tickets are a view over order lines grouped by order and station; no separate ticket table.
- Per line: start, ready, recall. Per ticket: bump (all ready). Expo station sees whole orders and
  marks them served or handed over.
- Timers from `firedAt`; colour thresholds per tenant (for example 5 and 10 minutes); priority
  flag; rush and allergy notes prominent.
- Order source badge (WhatsApp, Web, POS), fulfilment type, table or pickup name.
- All-day counts (how many of each item are outstanding).
- Sound on new ticket; works on a wall-mounted tablet in landscape; touch targets sized for
  gloves.

### 4.2 Storefront (Phase 2)

Reuses the cart, live repricing, stock reservation and hosted checkout that exist for retail.

```
StorefrontSettings (tenant)  theme colour, logo, cover photo, opening rules, min order,
                             delivery zones [{name, polygon or radius, feeMinor, minOrderMinor, etaMinutes}]
```

- Public pages on `<slug>.ordr.ae` (section 3.6): menu, item sheet with modifier groups (the
  catalog already stores min and max select), cart, checkout, `/o/<token>` tracking. Today's
  customer page (headline, about, photo, catalog, chat) is the base; with the module on, its
  catalog becomes orderable.
- Guest checkout with phone verification by OTP; an optional account is just the verified phone.
- Fulfilment: delivery (address, map pin, zone fee), pickup (branch, time), dine-in by table QR
  (`/t/<tableCode>` opens the menu bound to a table and adds to its tab).
- Scheduled orders (order now for later) within opening hours.
- Payment: online through the gateway port, or cash on delivery / pay at counter where the
  restaurant allows.
- Tracking page updates live from the public stream: received, preparing, ready, on its way,
  delivered.
- Arabic and English, right-to-left layout, mobile first.
- If WhatsApp is also on: order confirmation and status go to WhatsApp; "chat with us" opens the
  assistant.

### 4.3 POS (Phase 3)

Online only in v1.

```
Table        id, branchId, name, seats, area, x, y, shape
Shift        id, branchId, openedBy, openedAt, openingFloatMinor, closedBy, closedAt,
             countedCashMinor, expectedCashMinor
CashMovement id, shiftId, type (pay_in | pay_out | drop), amountMinor, reason, by
Payment      id, orderId, method (cash | card | online | voucher), amountMinor, tipMinor, ref,
             status, shiftId, by           (several per order: split bills, part payments)
Discount     on order or line: type (percent | amount), value, reason, by
```

- Sell screen: category tabs, item grid with photos, modifier sheet, running ticket, quick
  quantity, notes, search by name.
- Order types: dine-in (pick table, guests), takeaway (name), walk-in quick sale.
- Dine-in: floor plan, open tabs per table, add rounds, move or merge tables, fire by course,
  split bill by item or evenly.
- Payment: cash with change, card (terminal integration behind the port; manual "card taken"
  until then), split tender, tips, receipt by print, WhatsApp or SMS.
- Controls by role: discounts, voids with reason, refunds, price override.
- Shifts: open with float, pay-ins and pay-outs, close with counted cash and variance, X and Z
  reports.
- Printing: receipts and, where there is no KDS, kitchen chits. Needs a decision (section 7).
- Customer lookup by phone ties POS orders to the same customer record WhatsApp and Storefront
  use.

### 4.4 Inventory (Phase 4)

Inventory tracks everything the restaurant runs out of, not only food. A cup is stock exactly
like coffee beans are.

```
StockItem      id, tenantId, name, kind, baseUnit (g | ml | each), category, isActive
               kind: ingredient   coffee beans, milk, chicken
                     packaging    cups by size, lids, sleeves, straws, bags, boxes, napkins
                     prepared     made in-house in batches: cold brew, sauces, dough
                     resale       sold as bought: bottled water, canned drinks
                     supply       not sold: cleaning, gloves, printer rolls (counted and purchased only)
StockItemUnit  id, stockItemId, name (case of 1000, sleeve of 50, bottle, kg), toBaseFactor
Recipe         id, offeringId, variantId?, yield
RecipeLine     recipeId, stockItemId, quantityBase, appliesTo (all | takeaway | delivery | dine_in)
               modifier options can carry lines too ("extra shot" deducts 9 g of beans)
BatchRecipe    for prepared items: inputs and yield ("10 L cold brew from 1 kg beans")
StockLevel     branchId, stockItemId, onHandBase, reservedBase, parLevelBase, reorderPointBase
StockMovement  id, branchId, stockItemId, type (sale | purchase | wastage | count_adjust |
               transfer_in | transfer_out | production_in | production_out | reserve | release),
               quantityBase, unitCostMinor, refType, refId, by, at, note      append-only ledger
Supplier       id, tenantId, name, phone, email, leadDays
PurchaseOrder  id, branchId, supplierId, status (draft | sent | part_received | received |
               cancelled), lines [{stockItemId, unitId, qty, unitCostMinor, receivedQty}]
StockCount     id, branchId, status, lines [{stockItemId, countedBase, expectedBase}]
```

How cups and similar countables work:

- A cup, lid or bag is a `StockItem` of kind `packaging` with base unit `each`, bought by the
  case or sleeve and counted individually.
- A recipe line can depend on the size and on how the order leaves. A large takeaway latte
  deducts 18 g beans, 300 ml milk, one 16 oz cup and one lid; the same latte for dine-in deducts
  no cup. Variants (small, medium, large) each have their own recipe.
- Order-level packaging rules cover what is not tied to one item: one bag per takeaway order,
  one carrier per four drinks, napkins per guest.
- Cup counts double as a control: cups used against drinks sold shows giveaways, remakes and
  theft. The variance report shows this per size.
- Low-stock alerts and purchase suggestions work on cups the same way they do on ingredients.

- Deduction: on `order.item_status_changed` to preparing (or on `order.paid`, per tenant
  setting), write `sale` movements from the recipe, including modifier lines. A void after
  preparation becomes wastage; before preparation it reverses.
- `StockLevel.onHandBase` and `reservedBase` are cached sums of the ledger, rebuilt on demand.
  Available stock is on hand minus reserved.
- Batch production: making a batch of a prepared item consumes its inputs (`production_out`) and
  adds the batch (`production_in`), so cold brew or sauce has its own stock and cost.
- Purchasing: suggested order from par levels, send to supplier (WhatsApp if the module is on,
  else email or print), receive against the order with cost, part receipts.
- Wastage log with reason codes (spoiled, dropped, expired, staff meal).
- Stock counts: full or by category or kind (a quick daily cup count, a weekly full count),
  variance report, adjustment on approval.
- Low-stock alerts in the dashboard and by push; auto "86" an item on the menu, POS and
  storefront when a key ingredient runs out (per tenant setting).
- Reports: cost of goods, food cost percentage per item, usage, variance.

### 4.5 Party and catering orders (core capability, used by every module)

A party order is a large order for a future date, often priced and built differently from a
normal sale. It is the same `Order` with more freedom, not a separate system, so it flows to the
KDS, deducts stock and takes payments like any other order.

```
Order     + orderClass       standard | party
          + eventAt          when it must be ready or delivered (uses scheduledAt)
          + quoteStatus      draft | quoted | accepted | declined | expired   (party only)
          + headcount, eventNotes (venue, contact on the day, setup, equipment to bring back)
          + depositMinor, depositDueAt, balanceDueAt
OrderItem + isCustom         a free-text line not on the menu, with its own price and station
          + unitPriceOverrideMinor, priceNote
          + prepLeadMinutes  how long before eventAt the kitchen must start this line
OrderCharge  id, orderId, label (delivery, staff, equipment hire, setup), amountMinor, taxable
PartyPackage id, tenantId, name, pricePerHeadMinor, minHeadcount,
             lines [{offeringId, qtyPerHead or fixedQty, choiceGroup?}]
```

What makes it flexible:

- **Any size, any mix.** Menu items in bulk quantities, per-head packages ("breakfast for 40"),
  trays, and custom lines that are not on the menu at all, each with its own price.
- **Negotiated pricing.** Line price overrides, order-level discounts, and extra charges for
  delivery, staff or equipment, all with a reason and the name of who set them.
- **Quote first.** A draft becomes a quote the customer can accept by link or on WhatsApp; an
  accepted quote becomes a confirmed order. Quotes can be revised, and each revision is kept.
- **Deposit and balance.** Several payments over time on one order (the `Payment` table in POS
  already allows this): deposit on acceptance, balance before or on the day.
- **Stock is planned, not just deducted.** On confirmation the system works out what the order
  needs from its recipes, including cups, lids and boxes, and reserves it for the date
  (`reserve` movements). The requirements view shows need against available stock and turns any
  shortfall into a suggested purchase order timed by supplier lead days. Reservations become
  real deductions as lines are prepared, and release if the order is cancelled.
- **Custom lines and stock.** A custom line can carry an ad hoc ingredient list, or deduct
  nothing and leave stock to a manual adjustment.
- **Kitchen timing.** Lines appear on the KDS at `eventAt` minus their prep lead time, grouped
  as one party ticket with the due time prominent, instead of landing with the lunch rush. A
  printable prep sheet lists totals per item and per station.
- **Batch prep.** Where a party needs prepared items in bulk, the requirements view proposes
  the batches to produce beforehand.
- **Rules per restaurant.** Minimum notice, minimum order value, deposit percentage, blackout
  dates and a daily capacity limit, all tenant settings with sensible defaults.
- **Changes after confirmation.** Headcount and lines can change until a cut-off; each change
  recalculates totals, reservations and the balance due.

Where it shows up: taken at the POS or in the dashboard by staff, requested on the Storefront
("order for an event" form that creates a draft for staff to quote), and by WhatsApp, where the
assistant collects date, headcount and wishes and hands the draft to a person.

### 4.6 WhatsApp as an add-on (Phase 5, small)

Mostly re-packaging what exists:

- Behind the `whatsapp` entitlement: webhook routing, inbox, templates, handoff alerts.
- The restaurant ordering assistant places orders through the same core as POS and Storefront, so
  its orders appear on the KDS and deduct stock with no extra work.
- Move restaurant ordering from the guided menu to agent tools (cart with modifiers, delivery
  address) so it matches the storefront; this was already on the roadmap.

## 5. Phases and acceptance

| Phase | Delivers | Done when |
| --- | --- | --- |
| 0 Core | Entitlements, branches, order lines, stream, roles and PIN, row security | Existing restaurant WhatsApp flow passes unchanged; a tenant with no WhatsApp number works; two modules can be toggled per tenant; stream replays after a dropped connection |
| 1 KDS | Stations, tickets, timers, bump, expo, all-day | A WhatsApp order appears on the right station within a second, moves through line statuses, and the customer gets the usual status messages |
| 2 Storefront | Menu, customisation, cart, checkout, tracking, table QR | A guest orders delivery and pickup on a phone in Arabic and English, pays through the mock gateway, tracks live; the order reaches the KDS |
| 3 POS | Sell, tables and tabs, payments, shifts, receipts | A cashier runs a full shift: dine-in with rounds and split bill, takeaway, void and discount with reasons, close with variance |
| 4 Inventory | Stock items of every kind (ingredients, cups and packaging, prepared, resale), recipes, deduction, purchasing, wastage, counts, alerts | Selling a large takeaway latte deducts beans, milk, one cup and one lid, and the dine-in one deducts no cup; a purchase order is received; a cup count produces a variance against drinks sold; low stock alerts and auto-86 fire |
| 4b Party orders | Quotes, packages, custom lines, charges, deposits, stock reservation, timed kitchen release | A party for 60 is quoted, revised, accepted with a deposit; its stock is reserved and the shortfall becomes a purchase suggestion; on the day it appears on the KDS at the right time and the balance is taken |
| 5 WhatsApp add-on | Entitlement, agent ordering tools | A restaurant with POS and KDS only has no WhatsApp surfaces; one with WhatsApp gets agent ordering on the same core |

The order fields for party orders (class, quote status, custom lines, charges, deposits) are laid
down in Phase 0 with the other order changes, so no module has to be reworked for them later.
Quoting and deposits arrive with POS; reservation and requirements arrive with Inventory.

Each phase ships behind its entitlement, with the same test routine as today (unit, e2e in
memory, Postgres integration) and a migration that is additive.

## 6. Screen inventory for mockups

**Shared (dashboard)**

- Branch switcher in the header (hidden for single-branch tenants).
- Module launcher: which modules this tenant has, with a locked state for the others.
- PIN pad lock screen for shared devices; device pairing screen.
- Settings: branches, roles and PINs, stations, tables, taxes and service charge, receipt layout.

**KDS** (tablet landscape, wall screen)

- Station board: ticket columns or grid, each ticket with order number, source badge, type, table
  or name, elapsed timer with colour state, lines with modifiers and notes, per-line tap states.
- Expo board: whole orders, which stations are done, bump to served.
- All-day panel; recall drawer (recently bumped); station picker; empty and offline states.

**Storefront** (phone first, then desktop)

- Menu home (cover, hours, delivery/pickup toggle, category chips, item cards), item sheet with
  required and optional modifier groups, cart, checkout (contact and OTP, address and map,
  time, payment), confirmation, live tracking, closed and sold-out states, table-QR variant.

**POS** (tablet landscape)

- Sell screen (categories, grid, ticket), modifier sheet, order type picker, floor plan, table
  tab, split bill, payment (cash, card, split, tip), receipt options, discount and void dialogs
  with reasons, order history and refunds, shift open, cash in and out, shift close, X and Z
  reports.

**Inventory** (desktop and tablet)

- Stock list with kind filter (ingredients, packaging, prepared, resale, supplies), on-hand,
  reserved and status chips; item detail with ledger and units; recipe editor on a menu item
  with per-size and takeaway-only lines; order-level packaging rules; batch production;
  purchase orders (list, compose, receive); suppliers; wastage log; stock count (count sheet,
  quick cup count, variance review); cups-used against drinks-sold report; low-stock dashboard;
  reports.

**Party orders** (dashboard and POS; request form on Storefront)

- Party list and calendar (upcoming events, status, deposit state), party builder (date and
  time, headcount, packages, bulk items, custom lines, charges, price overrides), quote preview
  and send, customer acceptance page, payments timeline (deposit, balance), requirements view
  (need against stock, shortfall, suggested purchases and batches), prep sheet, party ticket on
  the KDS, storefront request form, party settings (notice, minimums, deposit, capacity).

**WhatsApp** (exists)

- Inbox, templates, conversation settings stay as they are, shown only when the module is on.

## 7. Open decisions

1. **Printing.** Browser printing to thermal printers is unreliable. Options: network printers
   through a small local print agent, or printers with a cloud API (Epson, Star). Needed before
   POS phase 3.
2. **Payment gateway and card terminal.** Candidates: Network International, Telr, Stripe UAE,
   Ziina. Needed before Storefront goes to a paying customer.
3. **Deduct stock at "preparing" or at "paid".** Default proposed: preparing.
4. **Delivery.** Own riders only, or an aggregator or dispatch partner hook later.
5. **Tax and service charge rules** beyond the current VAT-inclusive 5 percent (municipality fee,
   service charge on dine-in).
6. **Party order rules.** Defaults proposed: 48 hours minimum notice, 30 percent deposit on
   acceptance, balance due on the day, changes allowed until 24 hours before.
7. **Menu per branch.** Proposed: one menu, per-branch availability and price override. Separate
   menus per branch would be a bigger change.

## 8. Out of scope for this plan

Offline POS, aggregator integrations (Talabat, Deliveroo, Careem),
loyalty and gift cards, accounting exports, multi-currency, and any change to the salon, sports,
retail or resort verticals.
