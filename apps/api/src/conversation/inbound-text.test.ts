import { describe, expect, it } from "vitest";
import { describeMedia, textOf } from "./inbound-text";

describe("textOf", () => {
  it("passes words through: text, taps, locations", () => {
    expect(textOf({ kind: "text", text: "hi" })).toBe("hi");
    expect(textOf({ kind: "button", id: "yes", title: "Yes please" })).toBe("Yes please");
    expect(textOf({ kind: "list", id: "a", title: "Haircut" })).toBe("Haircut");
    expect(textOf({ kind: "location", latitude: 25.1, longitude: 55.2, name: "Marina" })).toBe("[shared location: Marina (25.1, 55.2)]");
  });

  it("uses an image or document caption as the message text", () => {
    expect(textOf({ kind: "media", mediaType: "image", mediaId: "m1", mimeType: "image/jpeg", caption: "do you have this in blue?" })).toBe("do you have this in blue?");
    expect(textOf({ kind: "media", mediaType: "document", mediaId: "m2", mimeType: "application/pdf", filename: "order.pdf", caption: "my order" })).toBe("my order");
  });

  it("describes media without a caption so the agent can respond instead of showing the menu", () => {
    expect(textOf({ kind: "media", mediaType: "audio", mediaId: "m3", mimeType: "audio/ogg" })).toBe("[sent a voice note]");
    expect(textOf({ kind: "media", mediaType: "image", mediaId: "m4", mimeType: "image/png", caption: "   " })).toBe("[sent an image]");
    expect(textOf({ kind: "media", mediaType: "video", mediaId: "m5", mimeType: "video/mp4" })).toBe("[sent a video]");
    expect(textOf({ kind: "media", mediaType: "sticker", mediaId: "m6", mimeType: "image/webp" })).toBe("[sent a sticker]");
    expect(describeMedia({ kind: "media", mediaType: "document", mediaId: "m7", mimeType: "application/pdf", filename: "menu.pdf" })).toBe("[sent a document: menu.pdf]");
    expect(describeMedia({ kind: "media", mediaType: "document", mediaId: "m8", mimeType: "application/pdf" })).toBe("[sent a document]");
  });

  it("stays null for content with no words", () => {
    expect(textOf({ kind: "reaction", messageId: "x", emoji: "👍" })).toBeNull();
    expect(textOf({ kind: "unsupported", rawType: "contacts" })).toBeNull();
  });
});
