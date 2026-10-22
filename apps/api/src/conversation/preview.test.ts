import { describe, expect, it } from "vitest";
import { agentTextOf, previewOf } from "./preview";

describe("previewOf", () => {
  it("labels media for the inbox from what was received and what the engine made of it", () => {
    expect(previewOf({ kind: "media", mediaType: "audio", mediaId: "m", mimeType: "audio/ogg", text: "[sent a voice note]", handling: "not_transcribed" })).toBe("Voice note");
    expect(previewOf({ kind: "media", mediaType: "audio", mediaId: "m", mimeType: "audio/ogg", text: "two shawarmas please", transcript: "two shawarmas please", handling: "transcribed" })).toBe("Voice note: two shawarmas please");
    expect(previewOf({ kind: "media", mediaType: "image", mediaId: "m", mimeType: "image/jpeg", caption: "this one?", text: "this one?", handling: "image_attached" })).toBe("Image: this one?");
    expect(previewOf({ kind: "media", mediaType: "image", mediaId: "m", mimeType: "image/jpeg" })).toBe("Image");
    expect(previewOf({ kind: "media", mediaType: "document", mediaId: "m", mimeType: "application/pdf", filename: "order.pdf" })).toBe("order.pdf");
    expect(previewOf({ kind: "media", mediaType: "sticker", mediaId: "m", mimeType: "image/webp" })).toBe("Sticker");
  });

  it("gives the agent the words the engine read, and the preview for everything else", () => {
    expect(agentTextOf({ kind: "media", mediaType: "audio", mediaId: "m", mimeType: "audio/ogg", text: "two shawarmas please", transcript: "two shawarmas please" })).toBe("two shawarmas please");
    expect(agentTextOf({ kind: "media", mediaType: "image", mediaId: "m", mimeType: "image/jpeg", text: "[sent an image]" })).toBe("[sent an image]");
    expect(agentTextOf({ kind: "text", text: "hello" })).toBe("hello");
    expect(agentTextOf({ type: "text", text: { body: "Hi there" } })).toBe("Hi there");
  });
});
