import { describe, expect, it } from "vitest";
import { AnthropicAssistant } from "./anthropic.assistant";
import type { TenantKnowledge } from "./assistant";

const knowledge: TenantKnowledge = {
  tenantName: "Demo Salon",
  blueprintId: "salon",
  timezone: "Asia/Dubai",
  services: [{ id: "svc_haircut", title: "Haircut", price: "AED 80.00", durationMinutes: 45 }],
  staff: [{ id: "res_sara", title: "Sara" }],
  intents: [
    { flow: "book_service", description: "Book an appointment", keywords: ["book"] },
    { flow: "my_bookings", description: "See or cancel upcoming bookings", keywords: ["bookings"] },
  ],
  facts: ["Free parking behind the building."],
};

/** A fetch that records the request and answers like the Messages API. */
function fakeApi(reply: (body: Record<string, unknown>) => Record<string, unknown>) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = Object.fromEntries(new Headers(init?.headers as Record<string, string>).entries());
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, headers, body });
    return new Response(JSON.stringify(reply(body)), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

const message = (text: string, extra: Record<string, unknown> = {}) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
  ...extra,
});

describe("AnthropicAssistant", () => {
  it("asks for a structured interpretation with fallbacks on and keeps only known flows", async () => {
    const api = fakeApi(() => message(JSON.stringify({ flow: "book_service", reply: null, confidence: "high" })));
    const assistant = new AnthropicAssistant({ apiKey: "k", model: "claude-opus-5-5", fetch: api.fetchImpl });
    const out = await assistant.interpret({ text: "can I get a haircut tomorrow", language: "en", knowledge, history: [{ role: "bot", text: "Welcome!" }] });
    expect(out).toEqual({ flow: "book_service", reply: null, confidence: "high" });

    const call = api.calls[0]!;
    expect(call.url).toMatch(/\/v1\/messages/);
    expect(call.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(call.body.model).toBe("claude-opus-5-5");
    expect(call.body.fallbacks).toBe("default");
    expect(call.body.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    // A leading bot turn is dropped so the conversation starts with the customer.
    expect(call.body.messages).toEqual([{ role: "user", content: "Customer: can I get a haircut tomorrow" }]);
    expect(JSON.stringify(call.body.system)).toContain("Free parking behind the building.");
  });

  it("ignores a flow the blueprint does not have", async () => {
    const api = fakeApi(() => message(JSON.stringify({ flow: "refund", reply: "Sure", confidence: "medium" })));
    const assistant = new AnthropicAssistant({ apiKey: "k", model: "claude-opus-5-5", fetch: api.fetchImpl });
    const out = await assistant.interpret({ text: "refund me", language: "en", knowledge, history: [] });
    expect(out).toEqual({ flow: null, reply: "Sure", confidence: "medium" });
  });

  it("maps free text onto an offered option and rejects unknown ids", async () => {
    let answer = "svc_haircut";
    const api = fakeApi(() => message(JSON.stringify({ optionId: answer })));
    const assistant = new AnthropicAssistant({ apiKey: "k", model: "claude-opus-5-5", fetch: api.fetchImpl });
    const options = [{ id: "svc_haircut", title: "Haircut" }, { id: "svc_color", title: "Colour" }];
    expect(await assistant.pickOption({ text: "the hair cut one", language: "en", prompt: "Which service?", options })).toBe("svc_haircut");
    answer = "svc_nope";
    expect(await assistant.pickOption({ text: "x", language: "en", prompt: "Which service?", options })).toBeNull();
  });

  it("treats a refusal, an API error and malformed JSON as 'not sure'", async () => {
    const refused = fakeApi(() => message("", { stop_reason: "refusal", stop_details: { type: "refusal", category: "general_harms" }, content: [] }));
    const a1 = new AnthropicAssistant({ apiKey: "k", model: "claude-opus-5-5", fetch: refused.fetchImpl });
    expect(await a1.pickOption({ text: "x", language: "en", prompt: "?", options: [{ id: "a", title: "A" }] })).toBeNull();

    const failing: typeof fetch = async () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "bad key" } }), { status: 401 });
    const a2 = new AnthropicAssistant({ apiKey: "k", model: "claude-opus-5-5", fetch: failing });
    expect(await a2.interpret({ text: "hi", language: "en", knowledge, history: [] })).toEqual({ flow: null, reply: null, confidence: "low" });
    await expect(a2.draftReply({ language: "en", knowledge, history: [] })).rejects.toThrow(/no draft/);

    const garbage = fakeApi(() => message("not json"));
    const a3 = new AnthropicAssistant({ apiKey: "k", model: "claude-opus-5-5", fetch: garbage.fetchImpl });
    expect(await a3.interpret({ text: "hi", language: "en", knowledge, history: [] })).toEqual({ flow: null, reply: null, confidence: "low" });
  });

  it("drafts an agent reply from the thread", async () => {
    const api = fakeApi(() => message(JSON.stringify({ reply: "Hi Noor, yes we have free parking behind the building." })));
    const assistant = new AnthropicAssistant({ apiKey: "k", model: "claude-opus-5-5", fetch: api.fetchImpl });
    const text = await assistant.draftReply({ language: "en", knowledge, history: [{ role: "customer", text: "is there parking?" }], instruction: "say yes, behind the building" });
    expect(text).toContain("parking");
    expect(api.calls[0]!.body.messages).toEqual([{ role: "user", content: "Customer: is there parking?" }]);
  });
});
