import type { InboundContent, InboundMedia } from "@ordr/whatsapp";

/**
 * What the customer said, as text the agent can read. Media without words becomes a short
 * bracketed note so the agent can answer sensibly (ask them to type it, say what it cannot do)
 * instead of the guided menu appearing out of nowhere. Null for reactions and unknown content.
 */
export function textOf(content: InboundContent): string | null {
  switch (content.kind) {
    case "text":
      return content.text;
    case "button":
    case "list":
      return content.title;
    case "location":
      return `[shared location: ${content.name ?? ""} ${content.address ?? ""} (${content.latitude}, ${content.longitude})]`.replace(/\s+/g, " ");
    case "media":
      return describeMedia(content);
    default:
      return null;
  }
}

/** The caption when there is one, otherwise a note naming what was sent. */
export function describeMedia(media: InboundMedia): string {
  const caption = media.caption?.trim();
  if (caption) return caption;
  switch (media.mediaType) {
    case "image":
      return "[sent an image]";
    case "video":
      return "[sent a video]";
    case "audio":
      return "[sent a voice note]";
    case "sticker":
      return "[sent a sticker]";
    case "document":
      return media.filename ? `[sent a document: ${media.filename}]` : "[sent a document]";
  }
}
