import { createHmac, timingSafeEqual } from "node:crypto";

export interface CheckoutRequest {
  intentId: string;
  tenantId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  description: string;
  /** Where the provider should send the customer afterwards. */
  returnUrl: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  providerRef?: string;
}

/** What a verified provider webhook says. */
export interface PaymentEvent {
  eventId: string;
  intentId: string;
  status: "paid" | "failed";
  providerRef?: string;
  amountMinor?: number;
}

/**
 * Hosted checkout behind a port: the chat only ever hands out a link, card data never touches
 * us, and an order becomes paid only on a webhook this adapter verified.
 */
export interface PaymentProvider {
  readonly name: string;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /** Null when the signature does not verify or the body is not an event this provider sent. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): PaymentEvent | null;
}

export const MOCK_SIGNATURE_HEADER = "x-mock-signature";

/**
 * Stand-in for a real gateway. The checkout URL is a page in the dashboard app; "paying" there
 * makes the API call this adapter to produce a signed event body, which then goes through the
 * same webhook endpoint and verification as a real provider's would.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  constructor(
    private readonly secret: string,
    private readonly publicBaseUrl: string,
  ) {}

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    return { checkoutUrl: `${this.publicBaseUrl.replace(/\/$/, "")}/pay/${encodeURIComponent(req.intentId)}`, providerRef: `mock_${req.intentId}` };
  }

  /** Builds the body and signature a real provider would deliver. */
  sign(event: PaymentEvent): { body: Buffer; signature: string } {
    const body = Buffer.from(JSON.stringify({ id: event.eventId, type: `payment.${event.status}`, data: { intentId: event.intentId, providerRef: event.providerRef ?? `mock_${event.intentId}`, amountMinor: event.amountMinor } }));
    return { body, signature: createHmac("sha256", this.secret).update(body).digest("hex") };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): PaymentEvent | null {
    const given = headers[MOCK_SIGNATURE_HEADER];
    const sig = Array.isArray(given) ? given[0] : given;
    if (!sig) return null;
    const expected = createHmac("sha256", this.secret).update(rawBody).digest("hex");
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    let parsed: { id?: unknown; type?: unknown; data?: { intentId?: unknown; providerRef?: unknown; amountMinor?: unknown } };
    try {
      parsed = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return null;
    }
    if (typeof parsed.id !== "string" || typeof parsed.type !== "string" || typeof parsed.data?.intentId !== "string") return null;
    const status = parsed.type === "payment.paid" ? "paid" : parsed.type === "payment.failed" ? "failed" : null;
    if (!status) return null;
    return {
      eventId: parsed.id,
      intentId: parsed.data.intentId,
      status,
      providerRef: typeof parsed.data.providerRef === "string" ? parsed.data.providerRef : undefined,
      amountMinor: typeof parsed.data.amountMinor === "number" ? parsed.data.amountMinor : undefined,
    };
  }
}
