import { describe, expect, it } from "vitest";
import { createTranscriber, NoopTranscriber, OpenAiTranscriber } from "./transcriber";

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

describe("OpenAiTranscriber", () => {
  it("posts the voice note as multipart with the model and language hint, and returns the text", async () => {
    const { impl, calls } = fakeFetch([{ body: { text: "  I'd like a haircut tomorrow  " } }]);
    const t = new OpenAiTranscriber({ apiKey: "sk-test", fetchImpl: impl });
    const out = await t.transcribe({ data: Buffer.from("OggS"), mimeType: "audio/ogg; codecs=opus", language: "en" });
    expect(out).toBe("I'd like a haircut tomorrow");
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    const form = calls[0]!.init.body as FormData;
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    expect(form.get("language")).toBe("en");
    const file = form.get("file") as File;
    expect(file.name).toBe("voice.ogg");
    expect(file.type).toBe("audio/ogg");
    expect(await file.text()).toBe("OggS");
  });

  it("returns null for silence and throws on provider errors", async () => {
    const { impl } = fakeFetch([{ body: { text: "   " } }, { status: 401, body: { error: { message: "Incorrect API key provided" } } }]);
    const t = new OpenAiTranscriber({ apiKey: "sk-test", fetchImpl: impl });
    expect(await t.transcribe({ data: Buffer.from("x"), mimeType: "audio/ogg" })).toBeNull();
    await expect(t.transcribe({ data: Buffer.from("x"), mimeType: "audio/ogg" })).rejects.toThrow("transcription failed (401): Incorrect API key provided");
  });

  it("is chosen by TRANSCRIPTION_PROVIDER and refuses to start without a key", () => {
    expect(createTranscriber({ TRANSCRIPTION_PROVIDER: "none" })).toBeInstanceOf(NoopTranscriber);
    expect(createTranscriber({ TRANSCRIPTION_PROVIDER: "openai", TRANSCRIPTION_API_KEY: "sk" })).toBeInstanceOf(OpenAiTranscriber);
    expect(() => createTranscriber({ TRANSCRIPTION_PROVIDER: "openai" })).toThrow("needs TRANSCRIPTION_API_KEY");
  });
});
