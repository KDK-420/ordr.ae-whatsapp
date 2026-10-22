import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FakeSender, fixtures, type OutboundMessage, parseWebhook } from "@ordr/whatsapp";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryConversationRepository, InMemoryDedupeStore, InMemorySessionStore, InMemoryTenantRepository } from "../src/adapters/memory";
import { InMemoryEventBus, InMemoryOrderRepository } from "../src/adapters/memory-catalog";
import type { AgentInput, AgentReply, ConversationAgent } from "../src/ai/agent";
import { FakeTranscriber } from "../src/ai/transcriber";
import { AppModule, seedTenantFromConfig } from "../src/app.module";
import { loadConfig } from "../src/config";
import { ConversationService } from "../src/conversation/conversation.service";

const EMAIL = "owner@demo.test";
const PASSWORD = "correct horse battery";
const bodyOf = (m: OutboundMessage | undefined): string => (!m ? "" : m.type === "text" ? m.text.body : m.type === "interactive" && "body" in m.interactive ? m.interactive.body.text : m.type);

class ScriptedAgent implements ConversationAgent {
  readonly enabled = true;
  readonly calls: AgentInput[] = [];
  next: AgentReply | Error = { text: "Got it!", handoff: false };
  async reply(input: AgentInput): Promise<AgentReply> {
    this.calls.push(input);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

/**
 * Inbound media in the natural style: a captioned photo reaches the agent as text plus an image
 * block, a voice note is transcribed when a provider is configured and described when not, and
 * the thread records what arrived. Nothing here touches Meta: the FakeSender serves the bytes.
 */
describe("inbound media", () => {
  let app: INestApplication;
  let sender: FakeSender;
  let agent: ScriptedAgent;
  let transcriber: FakeTranscriber;
  let conversations: InMemoryConversationRepository;
  let service: ConversationService;
  const base = { phoneNumberId: "200000000000000", from: "971500000001", profileName: "Noor" };
  const jpeg = Buffer.from("ffd8ffe000104a46494600", "hex");

  async function boot(opts: { transcriber?: FakeTranscriber } = {}) {
    const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory", WHATSAPP_SENDER: "log", SEED_PHONE_NUMBER_ID: base.phoneNumberId, SEED_BLUEPRINT_ID: "salon", SEED_TENANT_NAME: "Demo Salon", SEED_ADMIN_EMAIL: EMAIL, SEED_ADMIN_PASSWORD: PASSWORD });
    sender = new FakeSender();
    agent = new ScriptedAgent();
    conversations = new InMemoryConversationRepository();
    const overrides = { sender, agent, conversations, orders: new InMemoryOrderRepository(), sessions: new InMemorySessionStore(), tenants: new InMemoryTenantRepository([seedTenantFromConfig(config)]), eventBus: new InMemoryEventBus(), dedupe: new InMemoryDedupeStore(), ...(opts.transcriber ? { transcriber: opts.transcriber } : {}) };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register({ config, overrides })] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    service = app.get(ConversationService);
  }

  beforeEach(async () => {
    transcriber = new FakeTranscriber("a haircut tomorrow at four please");
    await boot();
  });
  afterEach(async () => {
    await app.close();
  });

  const send = async (payload: ReturnType<typeof fixtures.textMessageWebhook>) => {
    for (const ev of parseWebhook(payload)) await service.handleEvent(ev);
  };
  const last = () => sender.to(base.from).at(-1);
  const stored = async () => (await conversations.listMessages(agent.calls.at(-1)?.conversationId ?? [...conversations.conversations.keys()][0]!)).filter((m) => m.direction === "in");

  it("sends a captioned photo to the agent as its caption plus the image, and the inbox can fetch it", async () => {
    sender.media.set("img_1", { data: jpeg, mimeType: "image/jpeg" });
    agent.next = { text: "Yes, that is our balayage. Want a time?", handoff: false };
    await send(fixtures.mediaMessageWebhook("image", { id: "img_1", mimeType: "image/jpeg", caption: "can you do this colour?" }, base));

    expect(bodyOf(last())).toBe("Yes, that is our balayage. Want a time?");
    expect(agent.calls[0]).toMatchObject({ text: "can you do this colour?", attachments: [{ kind: "image", mimeType: "image/jpeg", data: jpeg.toString("base64") }] });
    expect(sender.downloads).toEqual(["img_1"]);
    const [message] = await stored();
    expect(message).toMatchObject({ kind: "media", payload: { mediaType: "image", mediaId: "img_1", caption: "can you do this colour?", text: "can you do this colour?", handling: "image_attached", sizeBytes: jpeg.length } });

    // The next message sees the photo turn in history as its caption, so the agent keeps the context.
    agent.next = { text: "Tomorrow at 15:00?", handoff: false };
    await send(fixtures.textMessageWebhook("tomorrow afternoon", base));
    expect(agent.calls[1]!.history.map((h) => `${h.role}:${h.text}`)).toEqual(["customer:can you do this colour?", "bot:Yes, that is our balayage. Want a time?", "customer:tomorrow afternoon"]);
    expect(agent.calls[1]!.attachments).toBeUndefined();

    // The inbox shows the picture through the API, with the merchant's session.
    const login = await request(app.getHttpServer()).post("/merchant/auth/login").send({ email: EMAIL, password: PASSWORD });
    const auth = { authorization: `Bearer ${login.body.token}` };
    const thread = await request(app.getHttpServer()).get(`/merchant/conversations/${message!.conversationId}`).set(auth);
    expect(thread.body.messages[0]).toMatchObject({ kind: "media", preview: "Image: can you do this colour?", payload: { mediaType: "image", handling: "image_attached" } });
    const picture = await request(app.getHttpServer()).get(`/merchant/conversations/${message!.conversationId}/media/${message!.id}`).set(auth);
    expect(picture.status).toBe(200);
    expect(picture.headers["content-type"]).toContain("image/jpeg");
    expect(Buffer.from(picture.body as ArrayBuffer).equals(jpeg)).toBe(true);
    expect((await request(app.getHttpServer()).get(`/merchant/conversations/${message!.conversationId}/media/${thread.body.messages[1].id}`).set(auth)).status).toBe(404);
  });

  it("describes a photo without a caption, and one over the size limit arrives as words only", async () => {
    sender.media.set("img_2", { data: jpeg, mimeType: "image/jpeg" });
    await send(fixtures.mediaMessageWebhook("image", { id: "img_2", mimeType: "image/jpeg" }, base));
    expect(agent.calls[0]).toMatchObject({ text: "[sent an image]" });
    expect(agent.calls[0]!.attachments).toHaveLength(1);

    sender.media.set("img_big", { data: Buffer.alloc(5 * 1024 * 1024 + 1), mimeType: "image/jpeg" });
    await send(fixtures.mediaMessageWebhook("image", { id: "img_big", mimeType: "image/jpeg", caption: "this one" }, base));
    expect(agent.calls[1]).toMatchObject({ text: "this one", attachments: [] });
    expect((await stored()).at(-1)).toMatchObject({ payload: { handling: "too_large" } });
    expect(bodyOf(last())).toBe("Got it!");
  });

  it("without a transcriber a voice note reaches the agent as a note, never the menu", async () => {
    await send(fixtures.mediaMessageWebhook("audio", { id: "voice_1", mimeType: "audio/ogg; codecs=opus" }, base));
    expect(bodyOf(last())).toBe("Got it!");
    expect(agent.calls[0]).toMatchObject({ text: "[sent a voice note]" });
    expect(sender.downloads).toEqual([]);
    expect((await stored())[0]).toMatchObject({ payload: { mediaType: "audio", text: "[sent a voice note]", handling: "not_transcribed" } });
  });

  it("with a transcriber the agent reads the words that were spoken, and the thread keeps the transcript", async () => {
    await app.close();
    await boot({ transcriber });
    const voice = Buffer.from("4f676753", "hex");
    sender.media.set("voice_2", { data: voice, mimeType: "audio/ogg" });
    await send(fixtures.mediaMessageWebhook("audio", { id: "voice_2", mimeType: "audio/ogg; codecs=opus" }, base));
    expect(agent.calls[0]).toMatchObject({ text: "a haircut tomorrow at four please", language: "en" });
    expect(transcriber.calls[0]).toMatchObject({ mimeType: "audio/ogg; codecs=opus", language: "en" });
    expect(transcriber.calls[0]!.data.equals(voice)).toBe(true);
    expect((await stored())[0]).toMatchObject({ payload: { handling: "transcribed", transcript: "a haircut tomorrow at four please", text: "a haircut tomorrow at four please" } });

    // A provider failure degrades to the note; the customer still gets an answer.
    transcriber.next = new Error("provider down");
    await send(fixtures.mediaMessageWebhook("audio", { id: "voice_2", mimeType: "audio/ogg" }, base));
    expect(agent.calls[1]).toMatchObject({ text: "[sent a voice note]" });
    expect((await stored())[1]).toMatchObject({ payload: { handling: "not_transcribed", error: "provider down" } });
  });

  it("skips stickers, video and documents: described, never downloaded", async () => {
    await send(fixtures.mediaMessageWebhook("sticker", { id: "st_1", mimeType: "image/webp" }, base));
    await send(fixtures.mediaMessageWebhook("video", { id: "vid_1", mimeType: "video/mp4", caption: "my hair now" }, base));
    await send(fixtures.mediaMessageWebhook("document", { id: "doc_1", mimeType: "application/pdf", filename: "inspo.pdf" }, base));
    expect(agent.calls.map((c) => c.text)).toEqual(["[sent a sticker]", "my hair now", "[sent a document: inspo.pdf]"]);
    expect(sender.downloads).toEqual([]);
    expect((await stored()).map((m) => m.payload)).toMatchObject([{ handling: "skipped" }, { handling: "skipped" }, { handling: "skipped" }]);
  });

  it("a photo that cannot be fetched still gets an answer from its caption", async () => {
    await send(fixtures.mediaMessageWebhook("image", { id: "gone", mimeType: "image/jpeg", caption: "is this in stock?" }, base));
    expect(agent.calls[0]).toMatchObject({ text: "is this in stock?", attachments: [] });
    expect((await stored())[0]).toMatchObject({ payload: { handling: "download_failed" } });
    expect(bodyOf(last())).toBe("Got it!");
  });
});
