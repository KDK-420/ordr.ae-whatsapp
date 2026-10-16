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

export const login = (email: string, password: string) =>
  call<{ token: string; expiresAt: string }>("/merchant/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
export const logout = () => call<void>("/merchant/auth/logout", { method: "POST" });
export const me = () => call<Me>("/merchant/me");
export const listOrders = (scope: "board" | "active" | "all" = "board") => call<OrderList>(`/merchant/orders?scope=${scope}`);
export const getOrder = (id: string) => call<OrderView>(`/merchant/orders/${encodeURIComponent(id)}`);
export const transitionOrder = (id: string, event: string) =>
  call<OrderView>(`/merchant/orders/${encodeURIComponent(id)}/transition`, { method: "POST", body: JSON.stringify({ event }) });
