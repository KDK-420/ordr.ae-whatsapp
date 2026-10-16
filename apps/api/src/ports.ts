import type { Category, Channel, Customer, DomainEvent, Offering, Order, OrderItem, OrderKind, OrderSource, PaymentStatus, DeliveryLocation, Tenant } from "@ordr/domain";
import type { LocalizedText } from "@ordr/domain";
import type { Blueprint, SessionState } from "@ordr/flow-schema";

export interface TenantContext {
  tenant: Tenant;
  channel: Channel;
}

export interface TenantRepository {
  findByPhoneNumberId(phoneNumberId: string): Promise<TenantContext | null>;
  findById(tenantId: string): Promise<Tenant | null>;
  /** Tenant with its active channel, for outbound messages that start on our side. */
  findContextById(tenantId: string): Promise<TenantContext | null>;
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
}

export interface CreateUserInput {
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
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

export interface OfferingInput {
  categoryId?: string | null;
  type?: "product" | "service";
  name: LocalizedText;
  description?: LocalizedText | null;
  priceMinor: number;
  currency?: string;
  durationMinutes?: number | null;
  imageUrl?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  /** When present, replaces every modifier group of the offering. */
  modifierGroups?: ModifierGroupInput[];
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
}

/** Builds the domain event to store in the outbox together with the change, once the saved order is known. */
export type OutboxFactory = (order: Order) => DomainEvent;

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
  counts(): Promise<Record<string, number>>;
}
