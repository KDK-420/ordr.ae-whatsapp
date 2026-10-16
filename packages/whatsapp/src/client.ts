import type { OutboundMessage } from "./outbound";
import type { MessageSender, SendResult, SendTarget } from "./sender";

export interface CloudApiClientOptions {
  graphVersion?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

export class CloudApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number | undefined,
    public readonly subcode: number | undefined,
    message: string,
    public readonly fbtraceId?: string,
  ) {
    super(message);
    this.name = "CloudApiError";
  }
}

export interface TemplateSummary {
  id?: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  rejectedReason?: string;
}

interface TemplateListResponse {
  data?: Array<{ id: string; name: string; language: string; status: string; category?: string; rejected_reason?: string }>;
  paging?: { next?: string };
}

/** Minimal Meta WhatsApp Cloud API client. One instance serves every tenant; tokens travel with each call. */
export class CloudApiClient implements MessageSender {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: CloudApiClientOptions = {}) {
    const version = opts.graphVersion ?? "v23.0";
    this.baseUrl = opts.baseUrl ?? `https://graph.facebook.com/${version}`;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  async send(target: SendTarget, message: OutboundMessage): Promise<SendResult> {
    const body = { messaging_product: "whatsapp", recipient_type: "individual", to: target.to, ...message };
    const res = await this.post<{ messages: Array<{ id: string }> }>(target.phoneNumberId, target.accessToken, body);
    const id = res.messages?.[0]?.id;
    if (!id) throw new CloudApiError(200, undefined, undefined, "Cloud API response did not include a message id");
    return { providerMessageId: id };
  }

  async markRead(target: Omit<SendTarget, "to">, messageId: string): Promise<void> {
    await this.post(target.phoneNumberId, target.accessToken, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    });
  }

  /**
   * Submits a text-only template for review. Meta needs example values for every placeholder.
   * Returns the template id and its initial review status (usually PENDING).
   */
  async createTemplate(
    wabaId: string,
    accessToken: string,
    definition: { name: string; language: string; category: string; body: string; examples: string[] },
  ): Promise<TemplateSummary> {
    const components: Array<Record<string, unknown>> = [
      { type: "BODY", text: definition.body, ...(definition.examples.length ? { example: { body_text: [definition.examples] } } : {}) },
    ];
    const res = await this.request<{ id: string; status: string; category?: string }>("POST", `${wabaId}/message_templates`, accessToken, {
      name: definition.name,
      language: definition.language,
      category: definition.category,
      components,
    });
    return { id: res.id, name: definition.name, language: definition.language, status: res.status, category: res.category ?? definition.category };
  }

  /** Every template on the WhatsApp Business Account with its review status. */
  async listTemplates(wabaId: string, accessToken: string): Promise<TemplateSummary[]> {
    const fields = "id,name,language,status,category,rejected_reason";
    const out: TemplateSummary[] = [];
    let path: string | undefined = `${wabaId}/message_templates?fields=${fields}&limit=100`;
    while (path) {
      const res: TemplateListResponse = await this.request<TemplateListResponse>("GET", path, accessToken);
      for (const t of res.data ?? []) {
        out.push({ id: t.id, name: t.name, language: t.language, status: t.status, category: t.category, rejectedReason: t.rejected_reason });
      }
      const next = res.paging?.next;
      path = next ? next.replace(`${this.baseUrl}/`, "") : undefined;
      if (path && path.startsWith("http")) break; // a different host: stop rather than loop forever
    }
    return out;
  }

  private post<T>(phoneNumberId: string, accessToken: string, body: unknown): Promise<T> {
    return this.request<T>("POST", `${phoneNumberId}/messages`, accessToken, body);
  }

  private async request<T>(method: "GET" | "POST", path: string, accessToken: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/${path}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message: string; code?: number; error_subcode?: number; fbtrace_id?: string };
      } & T;
      if (!res.ok || json.error) {
        const e = json.error;
        throw new CloudApiError(res.status, e?.code, e?.error_subcode, e?.message ?? `HTTP ${res.status}`, e?.fbtrace_id);
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }
}
