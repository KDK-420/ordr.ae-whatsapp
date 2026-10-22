/** One line of text for a stored message payload, inbound (parsed content) or outbound (Cloud API body). */
export function previewOf(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  if (p.kind === "media") return mediaPreview(p);
  if (typeof p.text === "string") return p.text;
  const text = p.text as { body?: unknown } | undefined;
  if (text && typeof text.body === "string") return text.body;
  const interactive = p.interactive as { body?: { text?: unknown } } | undefined;
  if (interactive?.body && typeof interactive.body.text === "string") return interactive.body.text;
  if (typeof p.title === "string") return p.title;
  const kind = (p.kind ?? p.type) as string | undefined;
  if (kind === "location") return "Location shared";
  if (kind === "template") return `Template: ${(p.template as { name?: string } | undefined)?.name ?? ""}`.trim();
  if (kind === "image") return "Image";
  if (kind === "document") return "Document";
  if (kind === "audio") return "Voice message";
  return kind ? `[${kind}]` : "";
}

/** "Voice note: <transcript>", "Image: <caption>", "Document: <filename>" and so on, for the inbox. */
function mediaPreview(p: Record<string, unknown>): string {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const caption = str(p.caption);
  switch (p.mediaType) {
    case "audio":
      return str(p.transcript) ? `Voice note: ${str(p.transcript)}` : "Voice note";
    case "image":
      return caption ? `Image: ${caption}` : "Image";
    case "video":
      return caption ? `Video: ${caption}` : "Video";
    case "sticker":
      return "Sticker";
    case "document": {
      const name = str(p.filename) ?? "Document";
      return caption ? `${name}: ${caption}` : name;
    }
    default:
      return "Attachment";
  }
}

/**
 * The words the agent should see for a stored inbound message: what the engine read it as
 * (caption, transcript or a bracketed note for media), the preview for everything else.
 */
export function agentTextOf(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (p.kind === "media" && typeof p.text === "string") return p.text;
  }
  return previewOf(payload);
}
