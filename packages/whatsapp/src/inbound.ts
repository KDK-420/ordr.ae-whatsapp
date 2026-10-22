import type { RawMessage, RawMessageBase, RawStatus, WebhookPayload } from "./webhook-types";

/** Normalized inbound content, independent of Meta's wire format. */
export type InboundContent =
  | { kind: "text"; text: string }
  | { kind: "button"; id: string; title: string }
  | { kind: "list"; id: string; title: string; description?: string }
  | { kind: "flow"; name: string; response: Record<string, unknown> }
  | { kind: "location"; latitude: number; longitude: number; name?: string; address?: string }
  | {
      kind: "order";
      catalogId: string;
      text?: string;
      items: Array<{ retailerId: string; quantity: number; price: number; currency: string }>;
    }
  | { kind: "media"; mediaType: "image" | "video" | "audio" | "document" | "sticker"; mediaId: string; mimeType: string; caption?: string; filename?: string }
  | { kind: "reaction"; messageId: string; emoji: string }
  | { kind: "unsupported"; rawType: string };

export interface InboundMessage {
  type: "message";
  /** Meta phone_number_id of the business number that received the message. */
  phoneNumberId: string;
  displayPhone: string;
  wabaId: string;
  messageId: string;
  from: string;
  profileName?: string;
  /** Unix seconds as sent by Meta. */
  timestamp: number;
  replyToMessageId?: string;
  content: InboundContent;
}

export interface InboundStatus {
  type: "status";
  phoneNumberId: string;
  wabaId: string;
  messageId: string;
  recipient: string;
  status: RawStatus["status"];
  timestamp: number;
  conversationId?: string;
  pricingCategory?: string;
  errors?: Array<{ code: number; title: string; details?: string }>;
}

export type InboundEvent = InboundMessage | InboundStatus;

/** A received image, video, voice note, document or sticker, before anything is downloaded. */
export type InboundMedia = Extract<InboundContent, { kind: "media" }>;

export function normalizeContent(raw: RawMessage): InboundContent {
  switch (raw.type) {
    case "text":
      return { kind: "text", text: raw.text.body };
    case "interactive": {
      const i = raw.interactive;
      if (i.type === "button_reply") return { kind: "button", id: i.button_reply.id, title: i.button_reply.title };
      if (i.type === "list_reply") {
        return { kind: "list", id: i.list_reply.id, title: i.list_reply.title, description: i.list_reply.description };
      }
      if (i.type === "nfm_reply") {
        let response: Record<string, unknown> = {};
        try {
          response = JSON.parse(i.nfm_reply.response_json) as Record<string, unknown>;
        } catch {
          response = { raw: i.nfm_reply.response_json };
        }
        return { kind: "flow", name: i.nfm_reply.name, response };
      }
      return { kind: "unsupported", rawType: "interactive" };
    }
    case "button":
      // Quick-reply button on a template message.
      return { kind: "button", id: raw.button.payload, title: raw.button.text };
    case "location":
      return { kind: "location", ...raw.location };
    case "order":
      return {
        kind: "order",
        catalogId: raw.order.catalog_id,
        text: raw.order.text,
        items: raw.order.product_items.map((p) => ({
          retailerId: p.product_retailer_id,
          quantity: p.quantity,
          price: p.item_price,
          currency: p.currency,
        })),
      };
    case "image":
    case "video":
    case "audio":
    case "sticker":
    case "document": {
      const media = (raw as unknown as Record<string, { id: string; mime_type: string; caption?: string; filename?: string }>)[raw.type]!;
      return {
        kind: "media",
        mediaType: raw.type,
        mediaId: media.id,
        mimeType: media.mime_type,
        caption: media.caption,
        filename: media.filename,
      };
    }
    case "reaction":
      return { kind: "reaction", messageId: raw.reaction.message_id, emoji: raw.reaction.emoji };
    default:
      // Meta adds message types over time; anything we do not model lands here.
      return { kind: "unsupported", rawType: (raw as RawMessageBase & { type: string }).type };
  }
}

/** Flattens a webhook payload into normalized message and status events. */
export function parseWebhook(payload: WebhookPayload): InboundEvent[] {
  const events: InboundEvent[] = [];
  if (payload.object !== "whatsapp_business_account") return events;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value;
      const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));

      for (const msg of value.messages ?? []) {
        events.push({
          type: "message",
          phoneNumberId: value.metadata.phone_number_id,
          displayPhone: value.metadata.display_phone_number,
          wabaId: entry.id,
          messageId: msg.id,
          from: msg.from,
          profileName: names.get(msg.from),
          timestamp: Number(msg.timestamp),
          replyToMessageId: msg.context?.id,
          content: normalizeContent(msg),
        });
      }

      for (const st of value.statuses ?? []) {
        events.push({
          type: "status",
          phoneNumberId: value.metadata.phone_number_id,
          wabaId: entry.id,
          messageId: st.id,
          recipient: st.recipient_id,
          status: st.status,
          timestamp: Number(st.timestamp),
          conversationId: st.conversation?.id,
          pricingCategory: st.pricing?.category,
          errors: st.errors?.map((e) => ({ code: e.code, title: e.title, details: e.error_data?.details })),
        });
      }
    }
  }
  return events;
}
