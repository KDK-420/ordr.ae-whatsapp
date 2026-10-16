import type { Category, Channel, Customer, DomainEvent, Offering, Order, OrderItem, OrderKind, OrderSource, PaymentStatus, DeliveryLocation, Tenant } from "@ordr/domain";
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

export interface ConversationRepository {
  upsertCustomer(tenantId: string, waId: string, name?: string): Promise<Customer>;
  findCustomerById(customerId: string): Promise<Customer | null>;
  findCustomersByIds(customerIds: string[]): Promise<Customer[]>;
  findConversationById(conversationId: string): Promise<(ConversationRecord & { lastInboundAt?: Date }) | null>;
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

export interface CatalogRepository {
  /** Active categories in display order. */
  listCategories(tenantId: string): Promise<Category[]>;
  /** Active offerings of a category in display order, with modifier groups. */
  listOfferings(tenantId: string, categoryId: string): Promise<Offering[]>;
  getOffering(tenantId: string, offeringId: string): Promise<Offering | null>;
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

export interface OrderRepository {
  /** Assigns the next per-tenant order number and records an "order.placed" history entry. */
  create(input: CreateOrderInput): Promise<Order>;
  findById(tenantId: string, orderId: string): Promise<Order | null>;
  latestForCustomer(tenantId: string, customerId: string): Promise<Order | null>;
  updateStatus(tenantId: string, orderId: string, status: string, event: { type: string; payload?: unknown }): Promise<Order>;
  listByStatus(tenantId: string, statuses: string[], limit?: number): Promise<Order[]>;
  /** Newest first, optionally restricted to statuses and to orders updated after `since`. */
  listRecent(tenantId: string, opts?: { statuses?: string[]; since?: Date; limit?: number }): Promise<Order[]>;
}

export type EventHandler = (event: DomainEvent) => Promise<void> | void;

/** In-process for now. The outbox relay and a broker replace the implementation, not the port. */
export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(type: string | "*", handler: EventHandler): () => void;
}
