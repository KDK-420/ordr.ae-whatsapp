/** One line of text for a stored message payload, inbound (parsed content) or outbound (Cloud API body). */
export function previewOf(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
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
