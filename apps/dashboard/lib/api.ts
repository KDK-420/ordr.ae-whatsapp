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
  user: { id: string; email: string; name: string; role: string; tenantId: string };
  tenant: { id: string; name: string; slug: string; blueprintId: string; defaultLanguage: string; timezone: string } | null;
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
export const setConversationStatus = (id: string, status: ConversationStatus) =>
  call<ConversationView>(`/merchant/conversations/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status }) });

export const login = (email: string, password: string) =>
  call<{ token: string; expiresAt: string }>("/merchant/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
export const logout = () => call<void>("/merchant/auth/logout", { method: "POST" });
export const me = () => call<Me>("/merchant/me");
export const listOrders = (scope: "board" | "active" | "all" = "board") => call<OrderList>(`/merchant/orders?scope=${scope}`);
export const getOrder = (id: string) => call<OrderView>(`/merchant/orders/${encodeURIComponent(id)}`);
export const transitionOrder = (id: string, event: string) =>
  call<OrderView>(`/merchant/orders/${encodeURIComponent(id)}/transition`, { method: "POST", body: JSON.stringify({ event }) });
