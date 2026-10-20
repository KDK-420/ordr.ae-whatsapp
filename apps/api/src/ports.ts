import type { Category, Channel, Customer, DomainEvent, Offering, Order, OrderItem, OrderKind, OrderSource, PaymentStatus, DeliveryLocation, Tenant } from "@ordr/domain";
import type { LocalizedText, Resource, WeeklyHours } from "@ordr/domain";
import type { PaymentStatus as OrderPaymentStatus } from "@ordr/domain";
import type { Blueprint, SessionState } from "@ordr/flow-schema";

export interface TenantContext {
  tenant: Tenant;
  channel: Channel;
}

export interface CreateTenantInput {
  name: string;
  slug: string;
  blueprintId: string;
  defaultLanguage?: string;
  timezone?: string;
  settings?: Record<string, unknown>;
}

export interface ChannelInput {
  phoneNumberId: string;
  wabaId: string;
  displayPhone: string;
  accessToken: string;
  /** Defaults to meta_cloud. */
  provider?: Channel["provider"];
}

export interface TenantRepository {
  findByPhoneNumberId(phoneNumberId: string): Promise<TenantContext | null>;
  findById(tenantId: string): Promise<Tenant | null>;
  /** Tenant with its active channel, for outbound messages that start on our side. */
  findContextById(tenantId: string): Promise<TenantContext | null>;
  /** Every tenant with its active channel, if any; newest first. Platform admin only. */
  list(): Promise<Array<{ tenant: Tenant; channel: Channel | null }>>;
  create(input: CreateTenantInput): Promise<Tenant>;
  /** Points a WhatsApp number at a tenant: creates the channel, or moves an existing one for that number. */
  attachChannel(tenantId: string, input: ChannelInput): Promise<Channel>;
  /** Stops routing for a number (status inactive); conversation history stays. */
  detachChannel(phoneNumberId: string): Promise<void>;
  /** Merges keys into tenant.settings (a null value removes the key). */
  updateSettings(tenantId: string, patch: Record<string, unknown>): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
}

/** A WhatsApp number the platform owns; assigned to at most one tenant at a time. */
export interface PooledNumber extends ChannelInput {
  id: string;
  label?: string;
  tenantId: string | null;
  createdAt: string;
}

export interface NumberPoolRepository {
  list(): Promise<PooledNumber[]>;
  findById(id: string): Promise<PooledNumber | null>;
  create(input: ChannelInput & { label?: string }): Promise<PooledNumber>;
  setTenant(id: string, tenantId: string | null): Promise<PooledNumber | null>;
}

export type UserRole = "owner" | "staff";

export interface UserRecord {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  isActive: boolean;
  /** Platform operator: tenants and the number pool at /admin. */
  isPlatformAdmin: boolean;
}

export interface CreateUserInput {
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  isPlatformAdmin?: boolean;
}

/** Merchant staff accounts for the dashboard. Emails are unique across tenants. */
export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(input: CreateUserInput): Promise<UserRecord>;
  touchLogin(id: string, at: Date): Promise<void>;
  listByTenant(tenantId: string): Promise<UserRecord[]>;
  update(id: string, patch: Partial<Pick<UserRecord, "name" | "role" | "isActive" | "passwordHash">>): Promise<UserRecord | null>;
}

export type ConversationStatus = "bot" | "human" | "closed";

export interface ConversationRecord {
  id: string;
  tenantId: string;
  customerId: string;
  channelId: string;
  status: ConversationStatus;
}

export interface MessageRecord {
  tenantId: string;
  conversationId: string;
  direction: "in" | "out";
  providerMessageId?: string;
  kind: string;
  payload: unknown;
  createdAt: Date;
}

export interface StoredMessage extends MessageRecord {
  id: string;
  /** Delivery status reported by Meta for outbound messages: sent, delivered, read, failed. */
  status?: string;
}

export interface ConversationSummary extends ConversationRecord {
  lastInboundAt?: Date;
  updatedAt: Date;
  customer: Customer | null;
  lastMessage?: { direction: "in" | "out"; kind: string; preview: string; createdAt: Date };
}

export interface ConversationRepository {
  upsertCustomer(tenantId: string, waId: string, name?: string): Promise<Customer>;
  findCustomerById(customerId: string): Promise<Customer | null>;
  findCustomersByIds(customerIds: string[]): Promise<Customer[]>;
  findConversationById(conversationId: string): Promise<(ConversationRecord & { lastInboundAt?: Date }) | null>;
  /** Most recently active first. */
  listConversations(tenantId: string, opts?: { status?: ConversationStatus; limit?: number }): Promise<ConversationSummary[]>;
  /** The last `limit` messages of a conversation, oldest first. */
  listMessages(conversationId: string, opts?: { limit?: number }): Promise<StoredMessage[]>;
  setCustomerLanguage(customerId: string, language: string): Promise<void>;
  getOrCreateOpenConversation(tenantId: string, customerId: string, channelId: string): Promise<ConversationRecord>;
  setConversationStatus(conversationId: string, status: ConversationStatus): Promise<void>;
  touchInbound(conversationId: string, at: Date): Promise<void>;
  recordMessage(message: MessageRecord): Promise<void>;
  updateMessageStatus(providerMessageId: string, status: string): Promise<void>;
}

export interface SessionStore {
  get(tenantId: string, waId: string): Promise<SessionState | null>;
  set(tenantId: string, waId: string, session: SessionState, ttlSeconds: number): Promise<void>;
  delete(tenantId: string, waId: string): Promise<void>;
}

export interface DedupeStore {
  /** Returns true the first time a key is seen within the TTL, false afterwards. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
}

export interface BlueprintRegistry {
  get(id: string): Blueprint | undefined;
}

export interface CategoryInput {
  name: LocalizedText;
  sortOrder?: number;
  isActive?: boolean;
}

export interface ModifierOptionInput {
  name: LocalizedText;
  priceDeltaMinor: number;
  sortOrder?: number;
  isActive?: boolean;
}

export interface ModifierGroupInput {
  name: LocalizedText;
  minSelect: number;
  maxSelect: number;
  sortOrder?: number;
  options: ModifierOptionInput[];
}

export interface VariantInput {
  id?: string;
  name: LocalizedText;
  sku?: string | null;
  priceMinor?: number | null;
  stock?: number | null;
  sortOrder?: number;
  isActive?: boolean;
}

export interface OfferingInput {
  categoryId?: string | null;
  type?: "product" | "service";
  name: LocalizedText;
  description?: LocalizedText | null;
  priceMinor: number;
  currency?: string;
  durationMinutes?: number | null;
  imageUrl?: string | null;
  /** Units on hand for a product without variants; null means not tracked. */
  stock?: number | null;
  sortOrder?: number;
  isActive?: boolean;
  /** When present, replaces every modifier group of the offering. */
  modifierGroups?: ModifierGroupInput[];
  /** When present, replaces every variant (matched by id where given, so stock survives edits). */
  variants?: VariantInput[];
}

export interface CatalogRepository {
  /** Active categories in display order. */
  listCategories(tenantId: string): Promise<Category[]>;
  /** Active offerings of a category in display order, with modifier groups. */
  listOfferings(tenantId: string, categoryId: string): Promise<Offering[]>;
  getOffering(tenantId: string, offeringId: string): Promise<Offering | null>;
  /** Everything, inactive included, for the dashboard. */
  listAllCategories(tenantId: string): Promise<Category[]>;
  listAllOfferings(tenantId: string): Promise<Offering[]>;
  createCategory(tenantId: string, input: CategoryInput): Promise<Category>;
  updateCategory(tenantId: string, categoryId: string, patch: Partial<CategoryInput>): Promise<Category | null>;
  createOffering(tenantId: string, input: OfferingInput): Promise<Offering>;
  updateOffering(tenantId: string, offeringId: string, patch: Partial<OfferingInput>): Promise<Offering | null>;
  /**
   * Atomically takes units off tracked stock for every line, or none of them. Untracked lines
   * always succeed. Returns the shortages when it could not reserve.
   */
  reserveStock(tenantId: string, lines: StockLine[]): Promise<{ ok: true } | { ok: false; shortages: StockShortage[] }>;
  releaseStock(tenantId: string, lines: StockLine[]): Promise<void>;
}

export interface StockLine {
  offeringId: string;
  variantId?: string;
  quantity: number;
}

export interface StockShortage extends StockLine {
  available: number;
}

export interface CartLine {
  offeringId: string;
  variantId?: string;
  title: string;
  variantTitle?: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface CartRecord {
  id: string;
  tenantId: string;
  customerId: string;
  conversationId?: string;
  status: "open" | "checked_out" | "expired";
  currency: string;
  items: CartLine[];
  expiresAt?: string;
  updatedAt: string;
}

export interface CartRepository {
  findOpen(tenantId: string, customerId: string): Promise<CartRecord | null>;
  create(tenantId: string, customerId: string, currency: string, conversationId?: string): Promise<CartRecord>;
  /** Replaces items and status of an existing cart. */
  save(cart: CartRecord): Promise<CartRecord>;
}

export type PaymentIntentStatus = "pending" | "paid" | "failed" | "expired";

export interface PaymentIntentRecord {
  id: string;
  tenantId: string;
  orderId: string;
  provider: string;
  amountMinor: number;
  currency: string;
  status: PaymentIntentStatus;
  checkoutUrl: string;
  providerRef?: string;
  expiresAt: string;
  paidAt?: string;
}

export interface PaymentIntentRepository {
  create(input: Omit<PaymentIntentRecord, "status" | "paidAt">): Promise<PaymentIntentRecord>;
  findById(id: string): Promise<PaymentIntentRecord | null>;
  findByOrder(tenantId: string, orderId: string): Promise<PaymentIntentRecord | null>;
  setStatus(id: string, status: PaymentIntentStatus, patch?: { providerRef?: string; paidAt?: Date }): Promise<PaymentIntentRecord | null>;
  /** Pending intents whose deadline passed, for the expiry job. */
  listExpired(now: Date, limit?: number): Promise<PaymentIntentRecord[]>;
}

/** Remembers provider webhook ids so a replay changes nothing. */
export interface WebhookReceiptRepository {
  /** True the first time an id is seen. */
  claim(provider: string, eventId: string): Promise<boolean>;
}

export type HoldStatus = "held" | "confirmed" | "released" | "expired";

export interface BookingHoldRecord {
  id: string;
  tenantId: string;
  customerId: string;
  conversationId?: string;
  offeringId: string;
  resourceId: string;
  startAt: string;
  endAt: string;
  status: HoldStatus;
  expiresAt: string;
}

export interface CreateHoldInput {
  tenantId: string;
  customerId: string;
  conversationId?: string;
  offeringId: string;
  resourceId: string;
  startAt: Date;
  endAt: Date;
  expiresAt: Date;
}

export interface BookingHoldRepository {
  /**
   * Creates a hold under the resource's row lock after checking it overlaps neither a live hold
   * nor a booking in `blockingStatuses`. Throws SlotTakenError otherwise.
   */
  create(input: CreateHoldInput, blockingStatuses: string[]): Promise<BookingHoldRecord>;
  findById(tenantId: string, id: string): Promise<BookingHoldRecord | null>;
  setStatus(id: string, status: HoldStatus): Promise<BookingHoldRecord | null>;
  /** Live holds (held, not expired) touching [from, to) on a resource, optionally ignoring one hold. */
  activeOverlapping(tenantId: string, resourceId: string, from: Date, to: Date, now: Date, exceptId?: string): Promise<BookingHoldRecord[]>;
  /** Marks held holds past their deadline as expired; resolves to the count. */
  expire(now: Date): Promise<number>;
}

export interface WebSessionRecord {
  id: string;
  tenantId: string;
  customerId: string;
  conversationId: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface WebSessionRepository {
  create(input: { tenantId: string; customerId: string; conversationId: string; tokenHash: string }): Promise<WebSessionRecord>;
  findByTokenHash(tokenHash: string): Promise<WebSessionRecord | null>;
  touch(id: string, at: Date): Promise<void>;
}

export type MemoryKind = "preference" | "fact" | "constraint";

export interface MemoryRecord {
  id: string;
  tenantId: string;
  customerId: string;
  kind: MemoryKind;
  key: string;
  value: unknown;
  confidence: number;
  sourceMessageIds: string[];
  consentPurpose: string;
  createdAt: string;
  lastConfirmedAt: string;
  expiresAt?: string;
  deletedAt?: string;
}

export interface ConsentRecord {
  customerId: string;
  tenantId: string;
  memory: boolean;
  purpose: string;
  sourceMessageId?: string;
  updatedAt: string;
}

export interface MemoryRepository {
  /** Live memories: not deleted, not expired at `now`, this tenant and customer only. */
  listActive(tenantId: string, customerId: string, now: Date): Promise<MemoryRecord[]>;
  /** Insert, or refresh the value and confirmation time of the live memory with the same key. */
  upsert(input: Omit<MemoryRecord, "id" | "createdAt" | "lastConfirmedAt" | "deletedAt">): Promise<MemoryRecord>;
  /** Soft-deletes one key, or everything for the customer when no key is given; resolves to the count. */
  forget(tenantId: string, customerId: string, key?: string): Promise<number>;
  getConsent(tenantId: string, customerId: string): Promise<ConsentRecord | null>;
  setConsent(input: Omit<ConsentRecord, "updatedAt">): Promise<ConsentRecord>;
}

export interface AgentRunRecord {
  id: string;
  tenantId: string;
  conversationId: string;
  inboundMessageId?: string;
  channel: string;
  model: string;
  tools: Array<{ name: string; input: unknown; ok: boolean; ms: number }>;
  memoryIds: string[];
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  outcome: "replied" | "handoff" | "error" | "fallback";
  error?: string;
  createdAt: string;
}

export interface AgentRunRepository {
  record(run: Omit<AgentRunRecord, "id" | "createdAt">): Promise<AgentRunRecord>;
  listForConversation(tenantId: string, conversationId: string, limit?: number): Promise<AgentRunRecord[]>;
}

export interface CreateOrderInput {
  tenantId: string;
  customerId: string;
  conversationId?: string;
  kind: OrderKind;
  initialStatus: string;
  fulfillmentType: string;
  source: OrderSource;
  items: OrderItem[];
  currency: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  vatMinor: number;
  totalMinor: number;
  paymentStatus: PaymentStatus;
  paymentMethod?: string;
  deliveryLocation?: DeliveryLocation;
  notes?: string;
  scheduledAt?: Date;
  resourceId?: string;
  durationMinutes?: number;
}

export type CreateBookingInput = CreateOrderInput & { scheduledAt: Date; resourceId: string; durationMinutes: number; /** The customer's own hold for this slot, ignored by the overlap check. */ holdId?: string };

export interface RescheduleInput {
  scheduledAt: Date;
  resourceId: string;
  durationMinutes: number;
  /** The customer's own hold for the new slot, ignored by the overlap check. */
  holdId?: string;
}

/** Builds the domain event to store in the outbox together with the change, once the saved order is known. */
export type OutboxFactory = (order: Order) => DomainEvent;

export interface ResourceInput {
  name: LocalizedText;
  type?: Resource["type"];
  hours?: WeeklyHours;
  skills?: string[];
  sortOrder?: number;
  isActive?: boolean;
}

export interface ResourceRepository {
  list(tenantId: string, opts?: { includeInactive?: boolean }): Promise<Resource[]>;
  get(tenantId: string, resourceId: string): Promise<Resource | null>;
  create(tenantId: string, input: ResourceInput): Promise<Resource>;
  update(tenantId: string, resourceId: string, patch: Partial<ResourceInput>): Promise<Resource | null>;
}

export interface OrderRepository {
  /**
   * Assigns the next per-tenant order number and records an "order.placed" history entry.
   * When `outbox` is given, the event it builds is written in the same transaction.
   */
  create(input: CreateOrderInput, outbox?: OutboxFactory): Promise<Order>;
  findById(tenantId: string, orderId: string): Promise<Order | null>;
  latestForCustomer(tenantId: string, customerId: string): Promise<Order | null>;
  updateStatus(tenantId: string, orderId: string, status: string, event: { type: string; payload?: unknown }, outbox?: OutboxFactory): Promise<Order>;
  listByStatus(tenantId: string, statuses: string[], limit?: number): Promise<Order[]>;
  /** Newest first, optionally restricted to statuses and to orders updated after `since`. */
  listRecent(tenantId: string, opts?: { statuses?: string[]; since?: Date; limit?: number }): Promise<Order[]>;
  /**
   * Like create, but serialized per resource: throws SlotTakenError when another order in one of
   * `blockingStatuses` overlaps the requested time on the same resource.
   */
  createBooking(input: CreateBookingInput, blockingStatuses: string[], outbox?: OutboxFactory): Promise<Order>;
  /** Moves a booking to a new slot under the same lock and overlap check; throws SlotTakenError. */
  reschedule(tenantId: string, orderId: string, input: RescheduleInput, blockingStatuses: string[], outbox?: OutboxFactory): Promise<Order>;
  /** Payment outcome from a verified provider event: sets payment status and order status together. */
  updatePayment(tenantId: string, orderId: string, paymentStatus: OrderPaymentStatus, status: string, event: { type: string; payload?: unknown }, outbox?: OutboxFactory): Promise<Order>;
  /** Orders scheduled in [from, to), soonest first. */
  listBookings(tenantId: string, opts: { from: Date; to: Date; resourceId?: string; statuses?: string[] }): Promise<Order[]>;
}

export type EventHandler = (event: DomainEvent) => Promise<void> | void;

/**
 * publish() hands an event to its handlers. In memory mode that happens right away in process.
 * With Postgres the API process only records the event in the outbox (OutboxEventBus) and the
 * worker process dispatches it from there (OutboxRelay over an InMemoryEventBus).
 */
export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(type: string | "*", handler: EventHandler): () => void;
}

export type TemplateStatus = "draft" | "pending" | "approved" | "rejected" | "paused" | "disabled";

export interface MessageTemplateRecord {
  id: string;
  tenantId: string;
  name: string;
  language: string;
  category: string;
  purpose: string;
  body: string;
  parameters: string[];
  status: TemplateStatus;
  metaId?: string;
  rejectedReason?: string;
  updatedAt: string;
}

export interface UpsertTemplateInput {
  tenantId: string;
  name: string;
  language: string;
  category: string;
  purpose: string;
  body: string;
  parameters: string[];
}

export interface TemplateRepository {
  list(tenantId: string): Promise<MessageTemplateRecord[]>;
  findApproved(tenantId: string, purpose: string, language: string): Promise<MessageTemplateRecord | null>;
  /** Creates or refreshes the definition (keyed by tenant, name and language), leaving status alone when it exists. */
  upsert(input: UpsertTemplateInput): Promise<MessageTemplateRecord>;
  setStatus(id: string, status: TemplateStatus, meta?: { metaId?: string; rejectedReason?: string }): Promise<void>;
}

export interface TemplateDefinition {
  name: string;
  language: string;
  category: string;
  body: string;
  /** Example values for the placeholders, which Meta requires when the body has variables. */
  examples: string[];
}

export interface RemoteTemplate {
  id?: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  rejectedReason?: string;
}

/** The part of Meta's management API that deals with message templates. */
export interface TemplateApi {
  createTemplate(wabaId: string, accessToken: string, definition: TemplateDefinition): Promise<RemoteTemplate>;
  listTemplates(wabaId: string, accessToken: string): Promise<RemoteTemplate[]>;
}

export interface OutboxRecord extends DomainEvent {
  /** Number of delivery attempts including the one in progress. */
  attempts: number;
}

/** Durable queue of domain events awaiting dispatch. */
export interface OutboxStore {
  /** Atomically claims up to `limit` due events, marking them "processing". */
  claim(limit: number, now?: Date): Promise<OutboxRecord[]>;
  markSent(id: string, at?: Date): Promise<void>;
  /** Schedules a retry at `retryAt`, or parks the event as "failed" when retryAt is null. */
  markFailed(id: string, error: string, retryAt: Date | null): Promise<void>;
  /** Returns events stuck in "processing" since before `olderThan` to "pending"; resolves to the count. */
  requeueStale(olderThan: Date): Promise<number>;
  /** Queues events to be dispatched no earlier than `at` (reminders). Ids already present are left alone. */
  schedule(events: DomainEvent[], at: Date): Promise<void>;
  counts(): Promise<Record<string, number>>;
}
