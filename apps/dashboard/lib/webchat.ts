/** Client for the public web chat and checkout endpoints (no merchant session; a per-visitor token instead). */

export interface WebMessage {
  id: string;
  role: "customer" | "assistant";
  text: string;
  createdAt: string;
}

export interface WebSession {
  sessionId: string;
  tenant: { name: string; slug: string; blueprintId: string; language: string };
  conversationId: string;
  status: "bot" | "human";
  messages: WebMessage[];
}

export interface PaymentView {
  id: string;
  provider: string;
  status: "pending" | "paid" | "failed" | "expired";
  amount: string;
  amountMinor: number;
  currency: string;
  expiresAt: string;
  order: { number: number; status: string; items: Array<{ title: string; variantTitle?: string; quantity: number; lineTotal: string }> };
  simulated: boolean;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) }, cache: "no-store" });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (body.message) message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    } catch {
      // keep the status text
    }
    throw new Error(message || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const startSession = (slug: string, language?: string) => call<WebSession & { token: string }>("/v1/chat/sessions", { method: "POST", body: JSON.stringify({ slug, language }) });
export const getSession = (id: string, token: string) => call<WebSession>(`/v1/chat/sessions/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` } });
export const sendMessage = (id: string, token: string, text: string, clientMessageId: string) =>
  call<WebSession>(`/v1/chat/sessions/${encodeURIComponent(id)}/messages`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ text, clientMessageId }) });

export const getPayment = (intent: string) => call<PaymentView>(`/v1/pay/${encodeURIComponent(intent)}`);
export const simulatePayment = (intent: string, outcome: "paid" | "fail") => call<{ ok: boolean; applied: boolean; status: string }>(`/v1/pay/${encodeURIComponent(intent)}/simulate`, { method: "POST", body: JSON.stringify({ outcome }) });

/** The hosted checkout link the assistant sends, rendered as a button instead of raw text. */
export const PAY_LINK = /https?:\/\/[^\s)]+\/pay\/[A-Za-z0-9-]+/g;
