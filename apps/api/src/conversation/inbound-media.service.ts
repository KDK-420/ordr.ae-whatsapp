import { Inject, Injectable, Logger } from "@nestjs/common";
import { type InboundMedia, MediaError, type MessageSender } from "@ordr/whatsapp";
import type { AgentAttachment } from "../ai/agent";
import type { Transcriber } from "../ai/transcriber";
import type { TenantContext } from "../ports";
import { TOKENS } from "../tokens";
import { describeMedia } from "./inbound-text";

/** Claude accepts images up to 5 MB each; WhatsApp sends voice notes as small Opus files, 16 MB is Meta's cap. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

const IMAGE_TYPES = new Set<AgentAttachment["mimeType"]>(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** What became of a received file. Stored with the message so the inbox and the audit trail can say. */
export type MediaHandling =
  | "image_attached" // downloaded and shown to the agent
  | "transcribed" // voice note turned into text
  | "not_transcribed" // no transcriber configured, or nothing intelligible
  | "too_large" // over the size limit for the model
  | "download_failed" // Meta or the sender port refused
  | "skipped"; // video, sticker, document, unsupported format, or guided style: described only

/** The inbound media content as stored: what Meta sent plus what the engine made of it. */
export interface StoredMediaPayload extends InboundMedia {
  /** What the conversation engine read this message as: caption, transcript or a bracketed note. */
  text: string;
  transcript?: string;
  handling: MediaHandling;
  sizeBytes?: number;
  error?: string;
}

export interface ReceivedMedia {
  text: string;
  attachments: AgentAttachment[];
  payload: StoredMediaPayload;
}

/**
 * Turns a media webhook into something the agent can use: images are downloaded and attached,
 * voice notes are transcribed, everything else is described. Never throws; a file that cannot be
 * fetched still reaches the agent as its caption or a note, so the customer gets an answer.
 */
@Injectable()
export class InboundMediaService {
  private readonly logger = new Logger(InboundMediaService.name);

  constructor(
    @Inject(TOKENS.MessageSender) private readonly sender: MessageSender,
    @Inject(TOKENS.Transcriber) private readonly transcriber: Transcriber,
  ) {}

  async receive(ctx: TenantContext, media: InboundMedia, opts: { attachImages: boolean; language?: string }): Promise<ReceivedMedia> {
    const described = describeMedia(media);
    const base = (handling: MediaHandling, extra: Partial<StoredMediaPayload> = {}): ReceivedMedia => ({
      text: extra.text ?? described,
      attachments: [],
      payload: { ...media, text: extra.text ?? described, handling, ...extra },
    });

    if (media.mediaType === "image" && opts.attachImages) {
      const mimeType = media.mimeType.split(";")[0]!.trim() as AgentAttachment["mimeType"];
      if (!IMAGE_TYPES.has(mimeType)) return base("skipped", { error: `unsupported image type ${media.mimeType}` });
      const fetched = await this.download(ctx, media.mediaId, MAX_IMAGE_BYTES);
      if ("handling" in fetched) return base(fetched.handling, { error: fetched.error });
      return {
        text: described,
        attachments: [{ kind: "image", mimeType, data: fetched.data.toString("base64") }],
        payload: { ...media, text: described, handling: "image_attached", sizeBytes: fetched.data.length },
      };
    }

    if (media.mediaType === "audio") {
      if (!this.transcriber.enabled) return base("not_transcribed");
      const fetched = await this.download(ctx, media.mediaId, MAX_AUDIO_BYTES);
      if ("handling" in fetched) return base(fetched.handling, { error: fetched.error });
      try {
        const transcript = (await this.transcriber.transcribe({ data: fetched.data, mimeType: media.mimeType, language: opts.language }))?.trim();
        if (!transcript) return base("not_transcribed", { sizeBytes: fetched.data.length });
        return base("transcribed", { text: transcript, transcript, sizeBytes: fetched.data.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`transcription failed for media ${media.mediaId}: ${message}`);
        return base("not_transcribed", { sizeBytes: fetched.data.length, error: message });
      }
    }

    return base("skipped");
  }

  private async download(ctx: TenantContext, mediaId: string, maxBytes: number): Promise<{ data: Buffer } | { handling: MediaHandling; error: string }> {
    if (!this.sender.downloadMedia) return { handling: "download_failed", error: "the configured sender cannot download media" };
    try {
      const { data } = await this.sender.downloadMedia(mediaId, ctx.channel.accessToken, { maxBytes });
      return { data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const handling: MediaHandling = err instanceof MediaError && err.code === "too_large" ? "too_large" : "download_failed";
      this.logger.warn(`media ${mediaId} for tenant ${ctx.tenant.id}: ${handling} (${message})`);
      return { handling, error: message };
    }
  }
}
