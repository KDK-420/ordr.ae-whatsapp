/** Thin client for the merchant API. Same origin: the session cookie travels automatically. */

export interface OrderItem {
  title: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  modifiers: Array<{ title: string; priceDeltaMinor: number }>;
  notes?: string;
}

export interface OrderView {
  id: string;
  number: number;
  kind?: "order" | "booking";
  scheduledAt?: string;
  resourceId?: string;
  durationMinutes?: number;
  status: string;
  fulfillmentType: string;
  source: string;
  items: OrderItem[];
  currency: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  vatMinor: number;
  totalMinor: number;
  paymentStatus: string;
  paymentMethod?: string;
  deliveryLocation?: { latitude: number; longitude: number; name?: string; address?: string; notes?: string };
  notes?: string;
  createdAt: string;
  updatedAt: string;
  customer: { id: string; name?: string; waId?: string; language?: string } | null;
  allowedEvents: string[];
  isTerminal: boolean;
}

export interface StateMachine {
  initial: string;
  states: string[];
  transitions: Array<{ from: string; to: string; on: string }>;
  terminal: string[];
}

export interface OrderList {
  orders: OrderView[];
  states: StateMachine;
}

export interface Me {
  user: { id: string; email: string; name: string; role: string; tenantId: string; platformAdmin: boolean };
  tenant: { id: string; name: string; slug: string; blueprintId: string; defaultLanguage: string; timezone: string; modules: string[] } | null;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/merchant/auth/")) {
    window.location.assign("/login");
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (body.message) message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    } catch {
      // keep the status text
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface MessageTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  purpose: string;
  body: string;
  parameters: string[];
  status: "draft" | "pending" | "approved" | "rejected" | "paused" | "disabled";
  metaId?: string;
  rejectedReason?: string;
  updatedAt: string;
}

export interface TemplateList {
  templates: MessageTemplate[];
  defaults: Array<{ purpose: string; name: string; bodies: Record<string, string> }>;
  languages: string[];
}

export type ConversationStatus = "bot" | "human" | "closed";

export interface ConversationView {
  id: string;
  status: ConversationStatus;
  customer: { id: string; name?: string; waId?: string; language?: string } | null;
  lastInboundAt?: string;
  updatedAt: string;
  lastMessage?: { direction: "in" | "out"; kind: string; preview: string; createdAt: string };
  windowOpen: boolean;
  windowClosesAt?: string;
}

export interface MessageView {
  id: string;
  direction: "in" | "out";
  kind: string;
  preview: string;
  payload: unknown;
  status?: string;
  createdAt: string;
}

export type LocalizedText = Record<string, string>;

export interface Category {
  id: string;
  name: LocalizedText;
  sortOrder: number;
  isActive: boolean;
}

export interface ModifierOption {
  id?: string;
  name: LocalizedText;
  priceDeltaMinor: number;
  sortOrder?: number;
  isActive: boolean;
}

export interface ModifierGroup {
  id?: string;
  name: LocalizedText;
  minSelect: number;
  maxSelect: number;
  sortOrder?: number;
  options: ModifierOption[];
}

export interface Offering {
  id: string;
  categoryId?: string | null;
  type: "product" | "service";
  name: LocalizedText;
  description?: LocalizedText | null;
  priceMinor: number;
  currency: string;
  durationMinutes?: number | null;
  sortOrder: number;
  isActive: boolean;
  modifierGroups: ModifierGroup[];
}

export type OfferingInput = Omit<Offering, "id" | "currency" | "type" | "sortOrder" | "modifierGroups"> & Partial<Pick<Offering, "currency" | "type" | "sortOrder" | "modifierGroups">>;

export const getCatalog = () => call<{ categories: Category[]; offerings: Offering[] }>("/merchant/catalog");
export const createCategory = (input: { name: LocalizedText; sortOrder?: number; isActive?: boolean }) =>
  call<Category>("/merchant/catalog/categories", { method: "POST", body: JSON.stringify(input) });
export const updateCategory = (id: string, patch: Partial<{ name: LocalizedText; sortOrder: number; isActive: boolean }>) =>
  call<Category>(`/merchant/catalog/categories/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
export const createOffering = (input: OfferingInput) => call<Offering>("/merchant/catalog/offerings", { method: "POST", body: JSON.stringify(input) });
export const updateOffering = (id: string, patch: Partial<OfferingInput>) =>
  call<Offering>(`/merchant/catalog/offerings/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: "owner" | "staff";
  isActive: boolean;
}

export const listUsers = () => call<{ users: StaffUser[] }>("/merchant/users");
export const createUser = (input: { email: string; name: string; role: "owner" | "staff" }) =>
  call<{ user: StaffUser; temporaryPassword: string }>("/merchant/users", { method: "POST", body: JSON.stringify(input) });
export const updateUser = (id: string, patch: Partial<Pick<StaffUser, "name" | "role" | "isActive">>) =>
  call<StaffUser>(`/merchant/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
export const resetUserPassword = (id: string) => call<{ temporaryPassword: string }>(`/merchant/users/${encodeURIComponent(id)}/reset-password`, { method: "POST" });
export const changePassword = (currentPassword: string, newPassword: string) =>
  call<void>("/merchant/me/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });

export const listTemplates = () => call<TemplateList>("/merchant/templates");
export const submitTemplates = () => call<{ templates: MessageTemplate[] }>("/merchant/templates/submit", { method: "POST" });
export const syncTemplates = () => call<{ templates: MessageTemplate[] }>("/merchant/templates/sync", { method: "POST" });

export const listConversations = (status?: ConversationStatus) =>
  call<{ conversations: ConversationView[] }>(`/merchant/conversations${status ? `?status=${status}` : ""}`);
export const getThread = (id: string) => call<{ conversation: ConversationView; messages: MessageView[] }>(`/merchant/conversations/${encodeURIComponent(id)}`);
export const replyToConversation = (id: string, text: string) =>
  call<MessageView>(`/merchant/conversations/${encodeURIComponent(id)}/messages`, { method: "POST", body: JSON.stringify({ text }) });
export const draftReply = (id: string, instruction?: string) =>
  call<{ text: string }>(`/merchant/conversations/${encodeURIComponent(id)}/draft`, { method: "POST", body: JSON.stringify({ instruction }) });
export const setConversationStatus = (id: string, status: ConversationStatus) =>
  call<ConversationView>(`/merchant/conversations/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status }) });

export type Weekday = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
export const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export type WeeklyHours = Partial<Record<Weekday, Array<{ start: string; end: string }>>>;
export interface Resource {
  id: string;
  type: "staff" | "room" | "asset";
  name: LocalizedText;
  hours: WeeklyHours;
  skills: string[];
  sortOrder: number;
  isActive: boolean;
}
export type ResourceInput = Partial<Omit<Resource, "id" | "name">> & { name: LocalizedText };
export const listResources = () => call<{ resources: Resource[] }>("/merchant/resources");
export const createResource = (input: ResourceInput) => call<Resource>("/merchant/resources", { method: "POST", body: JSON.stringify(input) });
export const updateResource = (id: string, patch: Partial<ResourceInput>) =>
  call<Resource>(`/merchant/resources/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });

export interface BookingList {
  bookings: OrderView[];
  resources: Resource[];
  states: StateMachine;
  timezone: string;
}
export const listBookings = (from: string, to: string) => call<BookingList>(`/merchant/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);

export interface BusinessProfile {
  address?: string;
  mapsUrl?: string;
  phone?: string;
  hours?: string;
}
export interface ConversationSettings {
  conversationStyle: "guided" | "natural";
  defaultStyle: "guided" | "natural";
  facts: string[];
  profile: BusinessProfile;
  assistantAvailable: boolean;
}
export const getConversationSettings = () => call<ConversationSettings>("/merchant/settings");
export const updateConversationSettings = (patch: { conversationStyle?: "guided" | "natural"; facts?: string[]; profile?: BusinessProfile }) =>
  call<ConversationSettings>("/merchant/settings", { method: "PATCH", body: JSON.stringify(patch) });

export interface PooledNumber {
  id: string;
  phoneNumberId: string;
  wabaId: string;
  displayPhone: string;
  label?: string;
  tenantId: string | null;
  createdAt: string;
}
export interface AdminOverview {
  tenants: Array<{
    tenant: { id: string; name: string; slug: string; blueprintId: string; defaultLanguage: string; timezone: string };
    channel: { id: string; phoneNumberId: string; displayPhone: string } | null;
    owners: Array<{ id: string; email: string; name: string }>;
  }>;
  numbers: PooledNumber[];
  verticals: Array<{ id: string; name: string; languages: string[] }>;
}
export interface CreateTenantResult {
  tenant: { id: string; name: string; slug: string; blueprintId: string };
  owner: { id: string; email: string; temporaryPassword: string };
  channel: { id: string; displayPhone: string } | null;
}
export const getAdminOverview = () => call<AdminOverview>("/merchant/admin/overview");
export const createTenant = (input: { name: string; blueprintId: string; ownerEmail: string; ownerName: string; defaultLanguage?: string; numberId?: string; seedDemo?: boolean }) =>
  call<CreateTenantResult>("/merchant/admin/tenants", { method: "POST", body: JSON.stringify(input) });
export const resetTenantOwnerPassword = (tenantId: string, userId: string) =>
  call<{ email: string; temporaryPassword: string }>(`/merchant/admin/tenants/${encodeURIComponent(tenantId)}/owners/${encodeURIComponent(userId)}/reset-password`, { method: "POST" });
export const addPooledNumber = (input: { phoneNumberId: string; wabaId: string; displayPhone: string; accessToken: string; label?: string }) =>
  call<PooledNumber>("/merchant/admin/numbers", { method: "POST", body: JSON.stringify(input) });
export const assignPooledNumber = (id: string, tenantId: string) => call<PooledNumber>(`/merchant/admin/numbers/${encodeURIComponent(id)}/assign`, { method: "POST", body: JSON.stringify({ tenantId }) });
export const releasePooledNumber = (id: string) => call<PooledNumber>(`/merchant/admin/numbers/${encodeURIComponent(id)}/release`, { method: "POST" });

export interface DemoCustomer {
  waId: string;
  name: string;
  conversationId: string;
  language?: string;
  updatedAt: string;
}
export interface DemoThread {
  customer: DemoCustomer;
  conversation: ConversationView;
  messages: MessageView[];
}
export type DemoInput =
  | { kind: "text"; text: string }
  | { kind: "button"; id: string; title: string }
  | { kind: "list"; id: string; title: string; description?: string }
  | { kind: "location"; latitude: number; longitude: number; name?: string; address?: string };

export const listDemoCustomers = () => call<{ customers: DemoCustomer[] }>("/merchant/simulator/customers");
export const createDemoCustomer = (name: string) => call<DemoCustomer>("/merchant/simulator/customers", { method: "POST", body: JSON.stringify({ name }) });
export const getDemoThread = (waId: string) => call<DemoThread>(`/merchant/simulator/customers/${encodeURIComponent(waId)}`);
export const sendDemoMessage = (waId: string, input: DemoInput) =>
  call<DemoThread>(`/merchant/simulator/customers/${encodeURIComponent(waId)}/messages`, { method: "POST", body: JSON.stringify(input) });
export const resetDemoCustomer = (waId: string) => call<DemoThread>(`/merchant/simulator/customers/${encodeURIComponent(waId)}/reset`, { method: "POST" });

export const login = (email: string, password: string) =>
  call<{ token: string; expiresAt: string }>("/merchant/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
export const logout = () => call<void>("/merchant/auth/logout", { method: "POST" });
export const me = () => call<Me>("/merchant/me");
export const listOrders = (scope: "board" | "active" | "all" = "board") => call<OrderList>(`/merchant/orders?scope=${scope}`);
export const getOrder = (id: string) => call<OrderView>(`/merchant/orders/${encodeURIComponent(id)}`);
export const transitionOrder = (id: string, event: string) =>
  call<OrderView>(`/merchant/orders/${encodeURIComponent(id)}/transition`, { method: "POST", body: JSON.stringify({ event }) });
