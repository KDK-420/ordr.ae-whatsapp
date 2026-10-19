import type { CartModifier } from "./cart";
import type { OfferingId, OrderId, ResourceId, TenantId } from "./ids";

/**
 * One Order type serves every vertical. A salon booking is an Order with a slot and a
 * resource; a food order is an Order whose constraint is kitchen capacity.
 */
export type OrderKind = "order" | "booking" | "appointment";
export type OrderSource = "whatsapp" | "pos" | "web";
export type PaymentStatus = "unpaid" | "pending" | "paid" | "refunded";

export interface OrderItem {
  id?: string;
  offeringId: OfferingId;
  title: string;
  quantity: number;
  unitPriceMinor: number;
  modifiers: CartModifier[];
  lineTotalMinor: number;
  notes?: string;
}

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
  /** Bookings: ISO start and length of the appointment. */
  scheduledAt?: string;
  durationMinutes?: number;
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
