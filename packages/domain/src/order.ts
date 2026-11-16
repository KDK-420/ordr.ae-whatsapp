import type { CartModifier } from "./cart";
import type { OfferingId, OrderId, ResourceId, TenantId } from "./ids";

/**
 * One Order type serves every vertical. A salon booking is an Order with a slot and a
 * resource; a food order is an Order whose constraint is kitchen capacity.
 */
export type OrderKind = "order" | "booking" | "appointment" | "stay";
export type OrderSource = "whatsapp" | "pos" | "web";
export type PaymentStatus = "unpaid" | "pending" | "paid" | "failed" | "refunded";

export interface OrderItem {
  id?: string;
  offeringId: OfferingId;
  variantId?: string;
  variantTitle?: string;
  title: string;
  quantity: number;
  unitPriceMinor: number;
  modifiers: CartModifier[];
  lineTotalMinor: number;
  notes?: string;
  /** Kitchen: the station that prepares the line and how far it is. */
  stationId?: string;
  kitchenStatus?: KitchenStatus;
  startedAt?: string;
  readyAt?: string;
}

/** Where a line is in the kitchen. */
export type KitchenStatus = "queued" | "preparing" | "ready" | "served";

export interface DeliveryLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
  notes?: string;
}

export interface Order {
  id: OrderId;
  tenantId: TenantId;
  /** Per-tenant human-friendly sequence, shown to customers and kitchen. */
  number: number;
  kind: OrderKind;
  /** Blueprint-defined; see StateMachine. */
  status: string;
  fulfillmentType: string;
  source: OrderSource;
  customerId: string;
  conversationId?: string;
  items: OrderItem[];
  resourceId?: ResourceId;
  /** Bookings: ISO start and length of the appointment. Stays: ISO check-in instant. */
  scheduledAt?: string;
  durationMinutes?: number;
  /** Stays: ISO check-out instant, guests and the property. */
  checkOutAt?: string;
  guests?: number;
  propertyId?: string;
  /** Restaurant suite: branch, table, who it is for, discount, and the kitchen clock. */
  branchId?: string;
  tableLabel?: string;
  contactName?: string;
  contactPhone?: string;
  discountMinor?: number;
  discountReason?: string;
  /** Client-chosen id that makes creating the order safe to retry. */
  clientRef?: string;
  /** Unguessable id for the customer's tracking page. */
  publicToken?: string;
  firedAt?: string;
  readyAt?: string;
  completedAt?: string;
  currency: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  vatMinor: number;
  totalMinor: number;
  paymentStatus: PaymentStatus;
  paymentMethod?: string;
  deliveryLocation?: DeliveryLocation;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
