import { describe, expect, it } from "vitest";
import { CloudApiClient, CloudApiError } from "./client";
import { text } from "./outbound";

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

describe("CloudApiClient", () => {
  it("sends messages to the phone number's /messages endpoint with the bearer token", async () => {
    const { impl, calls } = fakeFetch([{ body: { messages: [{ id: "wamid.1" }] } }]);
    const client = new CloudApiClient({ fetchImpl: impl, graphVersion: "v23.0" });
    const res = await client.send({ phoneNumberId: "123", accessToken: "tok", to: "9715" }, text("hi"));
    expect(res).toEqual({ providerMessageId: "wamid.1" });
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v23.0/123/messages");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ messaging_product: "whatsapp", to: "9715", type: "text" });
  });

  it("surfaces Meta errors with code and subcode", async () => {
    const { impl } = fakeFetch([{ status: 400, body: { error: { message: "Invalid parameter", code: 100, error_subcode: 33, fbtrace_id: "tr" } } }]);
    const client = new CloudApiClient({ fetchImpl: impl });
    await expect(client.send({ phoneNumberId: "123", accessToken: "tok", to: "9715" }, text("hi"))).rejects.toMatchObject({
      name: "CloudApiError",
      status: 400,
      code: 100,
      subcode: 33,
    } satisfies Partial<CloudApiError>);
  });

  it("submits templates with body examples and lists them across pages", async () => {
    const { impl, calls } = fakeFetch([
      { body: { id: "t1", status: "PENDING", category: "UTILITY" } },
      { body: { data: [{ id: "t1", name: "ordr_order_status", language: "en", status: "APPROVED", category: "UTILITY" }], paging: { next: "https://graph.facebook.com/v23.0/waba/message_templates?after=abc" } } },
      { body: { data: [{ id: "t2", name: "ordr_order_status", language: "ar", status: "REJECTED", rejected_reason: "INVALID_FORMAT" }] } },
    ]);
    const client = new CloudApiClient({ fetchImpl: impl, graphVersion: "v23.0" });
    const created = await client.createTemplate("waba", "tok", { name: "ordr_order_status", language: "en", category: "UTILITY", body: "Order #{{1}} is {{2}}.", examples: ["1", "ready"] });
    expect(created).toEqual({ id: "t1", name: "ordr_order_status", language: "en", status: "PENDING", category: "UTILITY" });
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v23.0/waba/message_templates");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      name: "ordr_order_status",
      language: "en",
      category: "UTILITY",
      components: [{ type: "BODY", text: "Order #{{1}} is {{2}}.", example: { body_text: [["1", "ready"]] } }],
    });

    const listed = await client.listTemplates("waba", "tok");
    expect(listed.map((t) => `${t.language}:${t.status}`)).toEqual(["en:APPROVED", "ar:REJECTED"]);
    expect(listed[1]!.rejectedReason).toBe("INVALID_FORMAT");
    expect(calls[1]!.init.method).toBe("GET");
    expect(calls[2]!.url).toContain("after=abc");
  });
});
