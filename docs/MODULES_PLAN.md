# Restaurant suite: modules plan

Status: agreed direction, 2026-11-16. Nothing here is built yet. Mockups are being designed in
parallel; the screen lists in section 6 are written for that.

Scope: restaurants only. Salon, retail and resort tenants keep working exactly as they do today
and are not touched by this plan.

## 1. What we are building

Five modules a restaurant can switch on independently, on top of one shared core.

| Module | Primary experience | Stands alone? |
| --- | --- | --- |
| Storefront (eCommerce) | Mobile-first ordering site: menu with customisation, cart, checkout, order tracking | Yes |
| POS | Fast touchscreen checkout for cashiers: dine-in, takeaway, walk-in | Yes |
| KDS | Real-time kitchen tickets with timers, priority and status | Needs one order source (Storefront, POS or WhatsApp) |
| Inventory | Ingredient stock, recipe-based deduction, purchasing, wastage, low-stock alerts | Needs the menu; useful once POS or Storefront feeds it sales |
| WhatsApp | The assistant that takes orders and answers customers on WhatsApp (today's product) | Yes |

Decisions already taken:

- One application, one database. Modules are boundaries in packaging and code, not separate
  services.
- Offline POS is a later phase. POS v1 needs a connection.
- Payments are built against the existing `PaymentProvider` port with the mock adapter; the real
  gateway and card terminal are chosen later and plug in behind the port.
- Storefront lives at a path on ordr.ae (`/s/<slug>`); custom domains come later.

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
apps/dashboard/app/(app)/kds, /pos, /inventory     staff screens
apps/dashboard/app/s/[slug]/...                    public storefront
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

### 3.6 Hardening that rides along

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

- Public pages: `/s/<slug>` menu, item sheet with modifier groups (the catalog already stores
  min and max select), cart, checkout, `/s/<slug>/o/<token>` tracking.
- Guest checkout with phone verification by OTP; an optional account is just the verified phone.
- Fulfilment: delivery (address, map pin, zone fee), pickup (branch, time), dine-in by table QR
  (`/s/<slug>/t/<tableCode>` opens the menu bound to a table and adds to its tab).
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

```
Ingredient     id, tenantId, name, baseUnit (g | ml | each), category, isActive
IngredientUnit id, ingredientId, name (case, bottle, kg), toBaseFactor
Recipe         id, offeringId (and variantId?), yield
RecipeLine     recipeId, ingredientId, quantityBase          (modifier options can carry lines too:
                                                               "extra cheese" deducts 20 g)
StockLevel     branchId, ingredientId, onHandBase, parLevelBase, reorderPointBase
StockMovement  id, branchId, ingredientId, type (sale | purchase | wastage | count_adjust |
               transfer_in | transfer_out | production), quantityBase, unitCostMinor, refType,
               refId, by, at, note                              append-only ledger
Supplier       id, tenantId, name, phone, email, leadDays
PurchaseOrder  id, branchId, supplierId, status (draft | sent | part_received | received |
               cancelled), lines [{ingredientId, unitId, qty, unitCostMinor, receivedQty}]
StockCount     id, branchId, status, lines [{ingredientId, countedBase, expectedBase}]
```

- Deduction: on `order.item_status_changed` to preparing (or on `order.paid`, per tenant
  setting), write `sale` movements from the recipe, including modifier lines. A void after
  preparation becomes wastage; before preparation it reverses.
- `StockLevel.onHandBase` is a cached sum of the ledger, rebuilt on demand.
- Purchasing: suggested order from par levels, send to supplier (WhatsApp if the module is on,
  else email or print), receive against the order with cost, part receipts.
- Wastage log with reason codes (spoiled, dropped, expired, staff meal).
- Stock counts: full or by category, variance report, adjustment on approval.
- Low-stock alerts in the dashboard and by push; auto "86" an item on the menu, POS and
  storefront when a key ingredient runs out (per tenant setting).
- Reports: cost of goods, food cost percentage per item, usage, variance.

### 4.5 WhatsApp as an add-on (Phase 5, small)

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
| 4 Inventory | Ingredients, recipes, deduction, purchasing, wastage, counts, alerts | Selling an item with modifiers deducts the right quantities; a purchase order is received; a count produces a variance; low stock alerts and auto-86 fire |
| 5 WhatsApp add-on | Entitlement, agent ordering tools | A restaurant with POS and KDS only has no WhatsApp surfaces; one with WhatsApp gets agent ordering on the same core |

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

- Ingredients list with on-hand and status chips, ingredient detail with ledger, recipe editor on
  a menu item, purchase orders (list, compose, receive), suppliers, wastage log, stock count
  (count sheet, variance review), low-stock dashboard, reports.

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
6. **Menu per branch.** Proposed: one menu, per-branch availability and price override. Separate
   menus per branch would be a bigger change.

## 8. Out of scope for this plan

Offline POS, custom storefront domains, aggregator integrations (Talabat, Deliveroo, Careem),
loyalty and gift cards, accounting exports, multi-currency, and any change to the salon, retail
or resort verticals.
