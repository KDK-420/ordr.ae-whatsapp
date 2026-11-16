import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.service";
import { TOKENS } from "../tokens";
import { InventoryService } from "./inventory.service";
import { KdsService } from "./kds.service";
import { PosService } from "./pos.service";
import { RealtimeHub } from "./realtime";
import { StoreService, toTracked } from "./store.service";
import { SuiteOrderService } from "./suite-order.service";
import { SuiteService } from "./suite.service";
import { SUITE_MODULES, SWATCHES, type SuiteRepository } from "./types";

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const res = schema.safeParse(body);
  if (!res.success) throw new BadRequestException(res.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return res.data;
}

const actor = (user: AuthUser) => `user:${user.email}`;
function requireOwner(user: AuthUser): void {
  if (user.role !== "owner") throw new ForbiddenException("only owners can change this");
}

const Line = z.object({ offeringId: z.string().min(1).max(100), quantity: z.number().int().min(1).max(99), optionIds: z.array(z.string().min(1).max(100)).max(30).optional(), notes: z.string().max(200).optional() });
const Lines = z.array(Line).min(1).max(60);
const Discount = z.object({ type: z.enum(["percent", "amount"]), value: z.number().min(0).max(100_000_000), reason: z.string().max(120).optional() });
const StationSchema = z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(1).max(40), categoryIds: z.array(z.string().min(1).max(100)).max(200).default([]) });
const BranchSchema = z.object({ name: z.string().trim().min(1).max(80), address: z.string().trim().max(300).nullable().optional(), phone: z.string().trim().max(40).nullable().optional(), stations: z.array(StationSchema).min(1).max(12).optional(), sortOrder: z.number().int().min(0).max(1000).optional(), isActive: z.boolean().optional() });

// ---------------------------------------------------------------------------
// Core: what the restaurant has, its branches, and the live stream
// ---------------------------------------------------------------------------

@Controller("merchant/suite")
@UseGuards(AuthGuard)
export class SuiteController {
  constructor(
    @Inject(SuiteService) private readonly suite: SuiteService,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
  ) {}

  @Get()
  view(@CurrentUser() user: AuthUser) {
    return this.suite.view(user.tenantId).then((v) => ({ ...v, user: { name: user.name, email: user.email, role: user.role } }));
  }

  @Post("branches")
  @HttpCode(201)
  createBranch(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    requireOwner(user);
    return this.suite.createBranch(user.tenantId, parse(BranchSchema, body));
  }

  @Patch("branches/:id")
  updateBranch(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    requireOwner(user);
    return this.suite.updateBranch(user.tenantId, id, parse(BranchSchema.partial(), body));
  }

  /**
   * Server-sent events: one small "something changed" signal per order or kitchen change of this
   * restaurant. Screens refetch on a signal and on every reconnect, so nothing depends on
   * receiving all of them. A comment line every 25 s keeps proxies from closing the connection.
   */
  @Get("stream")
  async stream(@CurrentUser() user: AuthUser, @Req() req: Request, @Res() res: Response) {
    await this.suite.requireAnyModule(user.tenantId, ["pos", "kds", "storefront", "inventory"]);
    res.status(200).set({ "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    res.flushHeaders();
    res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    const unsubscribe = this.hub.subscribe(user.tenantId, (event) => res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`));
    const beat = setInterval(() => res.write(": keep-alive\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(beat);
      unsubscribe();
    });
  }
}

/** Platform operator: which modules a restaurant has and how it looks. */
@Controller("merchant/admin/tenants")
@UseGuards(AuthGuard)
export class SuiteAdminController {
  constructor(@Inject(SuiteService) private readonly suite: SuiteService) {}

  @Get(":id/suite")
  async get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    if (!user.platformAdmin) throw new ForbiddenException("platform admins only");
    const view = await this.suite.view(id);
    return { modules: view.modules, theme: view.theme, available: SUITE_MODULES };
  }

  @Patch(":id/suite")
  configure(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    if (!user.platformAdmin) throw new ForbiddenException("platform admins only");
    const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
    const input = parse(
      z.object({
        modules: z.array(z.enum(SUITE_MODULES)).max(SUITE_MODULES.length).optional(),
        theme: z.object({ swatch: z.enum(SWATCHES).optional(), primary: hex.optional(), accent: hex.optional(), ink: hex.optional(), background: hex.optional(), text: hex.optional(), logoUrl: z.string().max(500).optional(), coverImageUrl: z.string().max(500).optional(), tagline: z.string().max(120).optional() }).optional(),
      }),
      body,
    );
    return this.suite.configure(id, input);
  }
}

// ---------------------------------------------------------------------------
// POS
// ---------------------------------------------------------------------------

const PosOrderSchema = z.object({
  branchId: z.string().min(1).optional(),
  clientRef: z.string().min(8).max(80).optional(),
  fulfillmentType: z.enum(["dine_in", "pickup", "delivery"]),
  lines: Lines,
  discount: Discount.optional(),
  tableLabel: z.string().max(30).optional(),
  contactName: z.string().max(80).optional(),
  contactPhone: z.string().max(30).optional(),
  notes: z.string().max(300).optional(),
  payment: z.object({ method: z.enum(["cash", "card"]), tenderedMinor: z.number().int().min(0).optional(), reference: z.string().max(80).optional() }).optional(),
});

@Controller("merchant/pos")
@UseGuards(AuthGuard)
export class PosController {
  constructor(
    @Inject(SuiteService) private readonly suite: SuiteService,
    @Inject(SuiteOrderService) private readonly orders: SuiteOrderService,
    @Inject(PosService) private readonly pos: PosService,
    @Inject(TOKENS.SuiteRepository) private readonly repo: SuiteRepository,
  ) {}

  @Post("quote")
  @HttpCode(200)
  async quote(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.suite.requireModule(user.tenantId, "pos");
    const input = parse(z.object({ lines: Lines, fulfillmentType: z.enum(["dine_in", "pickup", "delivery"]), discount: Discount.optional() }), body);
    return this.orders.quote(user.tenantId, input);
  }

  /** Rings up a sale: creates the order, sends it to the kitchen and, when given, takes the payment. */
  @Post("orders")
  @HttpCode(201)
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.suite.requireModule(user.tenantId, "pos");
    const input = parse(PosOrderSchema, body);
    const { order, created } = await this.orders.create({ ...input, tenantId: user.tenantId, source: "pos", actor: actor(user), paymentMethod: input.payment?.method });
    // A retried request finds the order it already made; it must not be charged twice.
    if (created && input.payment) await this.orders.pay(user.tenantId, order.id, { ...input.payment, actor: actor(user) });
    const fresh = await this.pos.dayOrders(user.tenantId, { branchId: order.branchId }).then((rows) => rows.find((o) => o.id === order.id));
    return fresh ?? (await this.pos.view(user.tenantId, order));
  }

  @Post("orders/:id/payments")
  @HttpCode(201)
  async pay(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    await this.suite.requireModule(user.tenantId, "pos");
    const input = parse(z.object({ method: z.enum(["cash", "card"]), amountMinor: z.number().int().positive().optional(), tenderedMinor: z.number().int().min(0).optional(), reference: z.string().max(80).optional() }), body);
    const { order } = await this.orders.pay(user.tenantId, id, { ...input, actor: actor(user) });
    return this.pos.view(user.tenantId, order);
  }

  @Get("orders")
  async list(@CurrentUser() user: AuthUser, @Query("branchId") branchId?: string, @Query("date") date?: string) {
    await this.suite.requireModule(user.tenantId, "pos");
    return { orders: await this.pos.dayOrders(user.tenantId, { branchId, date }) };
  }

  @Get("report")
  async report(@CurrentUser() user: AuthUser, @Query("branchId") branchId?: string, @Query("date") date?: string) {
    await this.suite.requireModule(user.tenantId, "pos");
    return this.pos.report(user.tenantId, { branchId, date });
  }

  @Get("customers")
  async customers(@CurrentUser() user: AuthUser) {
    await this.suite.requireModule(user.tenantId, "pos");
    return { customers: await this.pos.recentCustomers(user.tenantId) };
  }

  @Get("held")
  async held(@CurrentUser() user: AuthUser, @Query("branchId") branchId?: string) {
    await this.suite.requireModule(user.tenantId, "pos");
    const branch = await this.suite.branch(user.tenantId, branchId);
    return { tickets: await this.repo.listHeldTickets(user.tenantId, branch.id) };
  }

  @Post("held")
  @HttpCode(201)
  async hold(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.suite.requireModule(user.tenantId, "pos");
    const input = parse(z.object({ branchId: z.string().min(1).optional(), label: z.string().max(60).optional(), payload: z.record(z.string(), z.unknown()) }), body);
    if (JSON.stringify(input.payload).length > 20_000) throw new BadRequestException("that ticket is too large to hold");
    const branch = await this.suite.branch(user.tenantId, input.branchId);
    return this.repo.holdTicket({ tenantId: user.tenantId, branchId: branch.id, label: input.label?.trim() || undefined, payload: input.payload, createdBy: actor(user) });
  }

  @Delete("held/:id")
  @HttpCode(204)
  async release(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.suite.requireModule(user.tenantId, "pos");
    if (!(await this.repo.releaseTicket(user.tenantId, id))) throw new NotFoundException("held ticket not found");
  }
}

// ---------------------------------------------------------------------------
// KDS
// ---------------------------------------------------------------------------

@Controller("merchant/kds")
@UseGuards(AuthGuard)
export class KdsController {
  constructor(
    @Inject(SuiteService) private readonly suite: SuiteService,
    @Inject(KdsService) private readonly kds: KdsService,
  ) {}

  @Get("board")
  async board(@CurrentUser() user: AuthUser, @Query("branchId") branchId?: string, @Query("stationId") stationId?: string) {
    await this.suite.requireModule(user.tenantId, "kds");
    return this.kds.board(user.tenantId, { branchId: branchId || undefined, stationId: stationId || undefined });
  }

  @Post("orders/:id/advance")
  @HttpCode(200)
  async advance(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    await this.suite.requireModule(user.tenantId, "kds");
    const input = parse(z.object({ action: z.enum(["start", "ready", "complete"]), stationId: z.string().min(1).optional() }), body);
    return this.kds.advance(user.tenantId, id, input.action, { stationId: input.stationId, actor: actor(user) });
  }

  @Post("orders/:id/items/:itemId")
  @HttpCode(200)
  async line(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("itemId") itemId: string, @Body() body: unknown) {
    await this.suite.requireModule(user.tenantId, "kds");
    const input = parse(z.object({ status: z.enum(["queued", "preparing", "ready"]) }), body);
    return this.kds.setLine(user.tenantId, id, itemId, input.status, actor(user));
  }
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

const Qty = z.number().finite().min(-1_000_000).max(1_000_000);
const StockItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(60).nullable().optional(),
  kind: z.enum(["ingredient", "packaging", "prepared", "resale", "supply"]).optional(),
  baseUnit: z.enum(["g", "ml", "each"]).optional(),
  unitLabel: z.string().trim().max(40).optional(),
  unitSize: z.number().positive().max(1_000_000).optional(),
  reorderLevel: z.number().min(0).max(1_000_000).optional(),
  costMinor: z.number().int().min(0).max(100_000_000).optional(),
  isActive: z.boolean().optional(),
});
const PurchaseLineSchema = z.object({ stockItemId: z.string().min(1), quantity: z.number().positive().max(1_000_000), unitCostMinor: z.number().int().min(0).max(100_000_000) });
const SupplierSchema = z.object({ name: z.string().trim().min(1).max(120), phone: z.string().trim().max(40).optional(), email: z.string().trim().max(200).optional(), notes: z.string().trim().max(300).optional(), leadDays: z.number().int().min(0).max(365).optional(), isActive: z.boolean().optional() });

@Controller("merchant/inventory")
@UseGuards(AuthGuard)
export class InventoryController {
  constructor(
    @Inject(SuiteService) private readonly suite: SuiteService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  @Get("overview")
  async overview(@CurrentUser() user: AuthUser, @Query("branchId") branchId?: string) {
    await this.suite.requireModule(user.tenantId, "inventory");
    return this.inventory.overview(user.tenantId, branchId || undefined);
  }

  @Post("items")
  @HttpCode(201)
  async createItem(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.suite.requireModule(user.tenantId, "inventory");
    const input = parse(StockItemSchema.extend({ openingStock: z.number().min(0).max(1_000_000).optional(), branchId: z.string().min(1).optional() }), body);
    return this.inventory.createItem(user.tenantId, input, actor(user));
  }

  @Patch("items/:id")
  async updateItem(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    await this.suite.requireModule(user.tenantId, "inventory");
    return this.inventory.updateItem(user.tenantId, id, parse(StockItemSchema.partial(), body));
  }

  @Get("movements")
  async movements(@CurrentUser() user: AuthUser, @Query("branchId") branchId?: string, @Query("stockItemId") stockItemId?: string, @Query("types") types?: string) {
    await this.suite.requireModule(user.tenantId, "inventory");
    const wanted = types ? parse(z.array(z.enum(["sale", "sale_reversal", "purchase", "adjustment", "wastage", "count"])), types.split(",")) : undefined;
    return { movements: await this.inventory.movements(user.tenantId, { branchId: branchId || undefined, stockItemId: stockItemId || undefined, types: wanted }) };
  }

  @Post("adjustments")
  @HttpCode(201)
  async adjust(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.suite.requireModule(user.tenantId, "inventory");
    const input = parse(z.object({ branchId: z.string().min(1).optional(), stockItemId: z.string().min(1), type: z.enum(["adjustment", "wastage", "count"]), quantity: Qty, note: z.string().max(200).optional() }), body);
    return this.inventory.adjust(user.tenantId, input, actor(user));
  }

  @Get("recipes")
  async recipes(@CurrentUser() user: AuthUser) {
    await this.suite.requireModule(user.tenantId, "inventory");
    return { lines: await this.inventory.recipes(user.tenantId) };
  }

  @Put("recipes/:offeringId")
  async setRecipe(@CurrentUser() user: AuthUser, @Param("offeringId") offeringId: string, @Body() body: unknown) {
    await this.suite.requireModule(user.tenantId, "inventory");
    const input = parse(z.object({ lines: z.array(z.object({ stockItemId: z.string().min(1), quantity: z.number().positive().max(1_000_000), modifierOptionId: z.string().min(1).optional(), appliesTo: z.enum(["all", "takeaway", "dine_in"]).optional() })).max(60) }), body);
    return { lines: await this.inventory.setRecipe(user.tenantId, offeringId, input.lines) };
  }

  @Get("suppliers")
  async suppliers(@CurrentUser() user: AuthUser) {
    await this.suite.requireModule(user.tenantId, "inventory");
    return { suppliers: await this.inventory.suppliers(user.tenantId) };
  }

  @Post("suppliers")
  @HttpCode(201)
  async createSupplier(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.suite.requireModule(user.tenantId, "inventory");
    return this.inventory.createSupplier(user.tenantId, parse(SupplierSchema, body));
  }

  @Patch("suppliers/:id")
  async updateSupplier(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    await this.suite.requireModule(user.tenantId, "inventory");
    return this.inventory.updateSupplier(user.tenantId, id, parse(SupplierSchema.partial(), body));
  }

  @Get("purchases")
  async purchases(@CurrentUser() user: AuthUser, @Query("branchId") branchId?: string) {
    await this.suite.requireModule(user.tenantId, "inventory");
    return { purchases: await this.inventory.purchases(user.tenantId, branchId || undefined) };
  }

  @Post("purchases")
  @HttpCode(201)
  async createPurchase(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.suite.requireModule(user.tenantId, "inventory");
    const input = parse(z.object({ branchId: z.string().min(1).optional(), supplierId: z.string().min(1).optional(), lines: z.array(PurchaseLineSchema).min(1).max(100), notes: z.string().max(300).optional(), status: z.enum(["draft", "ordered"]).optional() }), body);
    return this.inventory.createPurchase(user.tenantId, input, actor(user));
  }

  @Post("purchases/:id/receive")
  @HttpCode(200)
  async receive(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.suite.requireModule(user.tenantId, "inventory");
    return this.inventory.receivePurchase(user.tenantId, id, actor(user));
  }

  @Post("purchases/:id/cancel")
  @HttpCode(200)
  async cancel(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.suite.requireModule(user.tenantId, "inventory");
    return this.inventory.cancelPurchase(user.tenantId, id);
  }

  @Get("report")
  async report(@CurrentUser() user: AuthUser, @Query("branchId") branchId?: string, @Query("from") from?: string, @Query("to") to?: string) {
    await this.suite.requireModule(user.tenantId, "inventory");
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - 30 * 24 * 60 * 60_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new BadRequestException("from and to must be dates, with to after from");
    return this.inventory.report(user.tenantId, { branchId: branchId || undefined, from: start, to: end });
  }
}

// ---------------------------------------------------------------------------
// Storefront (public)
// ---------------------------------------------------------------------------

const StoreOrderSchema = z.object({
  clientRef: z.string().min(8).max(80),
  branchId: z.string().min(1).optional(),
  fulfillmentType: z.enum(["pickup", "delivery"]),
  lines: Lines,
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(8).max(30),
  address: z.string().trim().max(300).optional(),
  notes: z.string().max(300).optional(),
  language: z.enum(["en", "ar"]).optional(),
});

/** Public, no login: a restaurant's ordering site. Tenants without the Storefront module look like they do not exist. */
@Controller("v1/store")
export class StoreController {
  constructor(
    @Inject(StoreService) private readonly store: StoreService,
    @Inject(SuiteOrderService) private readonly orders: SuiteOrderService,
    @Inject(SuiteService) private readonly suite: SuiteService,
  ) {}

  @Get(":slug")
  get(@Param("slug") slug: string, @Query("lang") lang?: string) {
    return this.store.store(slug.toLowerCase(), lang);
  }

  @Post(":slug/quote")
  @HttpCode(200)
  async quote(@Param("slug") slug: string, @Body() body: unknown) {
    const tenant = await this.store.storeTenant(slug.toLowerCase());
    const input = parse(z.object({ lines: Lines, fulfillmentType: z.enum(["pickup", "delivery"]), language: z.enum(["en", "ar"]).optional() }), body);
    return this.orders.quote(tenant.id, input);
  }

  @Post(":slug/orders")
  @HttpCode(201)
  async create(@Param("slug") slug: string, @Body() body: unknown) {
    const tenant = await this.store.storeTenant(slug.toLowerCase());
    const input = parse(StoreOrderSchema, body);
    if (input.fulfillmentType === "delivery" && !input.address?.trim()) throw new BadRequestException("a delivery needs an address");
    const { order, branch } = await this.orders.create({ tenantId: tenant.id, source: "web", branchId: input.branchId, fulfillmentType: input.fulfillmentType, lines: input.lines, contactName: input.name, contactPhone: input.phone, address: input.address, notes: input.notes, clientRef: `web:${input.clientRef}`, language: input.language, paymentMethod: "cash" });
    const view = await this.suite.view(tenant.id);
    return { token: order.publicToken, order: toTracked(order, input.language ?? tenant.defaultLanguage, view.vatInclusive, branch) };
  }

  @Get(":slug/orders/:token")
  track(@Param("slug") slug: string, @Param("token") token: string, @Query("lang") lang?: string) {
    return this.store.track(slug.toLowerCase(), token, lang);
  }
}
