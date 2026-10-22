import type { OutboundMessage } from "./outbound";

export interface SendTarget {
  /** Business number to send from (Meta phone_number_id). */
  phoneNumberId: string;
  accessToken: string;
  /** Customer wa_id. */
  to: string;
}

export interface SendResult {
  providerMessageId: string;
}

/** A received media file, fetched from Meta with the channel's token. */
export interface DownloadedMedia {
  data: Buffer;
  mimeType: string;
  sha256?: string;
}

export interface DownloadMediaOptions {
  /** Refuse files larger than this (bytes), before and after fetching. */
  maxBytes?: number;
}

export class MediaError extends Error {
  constructor(
    public readonly code: "too_large" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "MediaError";
  }
}

/**
 * Anything that can deliver an outbound message. Implemented by the Cloud API client and by fakes.
 * Media download rides on the same port because it needs the same per-channel token and the same
 * "never reach Meta" guarantee in tests and with WHATSAPP_SENDER=log.
 */
export interface MessageSender {
  send(target: SendTarget, message: OutboundMessage): Promise<SendResult>;
  markRead?(target: Omit<SendTarget, "to">, messageId: string): Promise<void>;
  /** Fetches a received media file by the id from the webhook. Throws MediaError when it cannot. */
  downloadMedia?(mediaId: string, accessToken: string, opts?: DownloadMediaOptions): Promise<DownloadedMedia>;
}

export interface SentRecord {
  target: SendTarget;
  message: OutboundMessage;
  providerMessageId: string;
}

/** Records every send in memory. Used by tests and the local simulator. */
export class FakeSender implements MessageSender {
  public readonly sent: SentRecord[] = [];
  /** Media a test makes available by id, as a webhook would announce it. */
  public readonly media = new Map<string, DownloadedMedia>();
  /** Media ids that were asked for, in order. */
  public readonly downloads: string[] = [];
  private counter = 0;

  async send(target: SendTarget, message: OutboundMessage): Promise<SendResult> {
    const providerMessageId = `wamid.fake.${++this.counter}`;
    this.sent.push({ target, message, providerMessageId });
    return { providerMessageId };
  }

  async markRead(): Promise<void> {}

  async downloadMedia(mediaId: string, _accessToken: string, opts: DownloadMediaOptions = {}): Promise<DownloadedMedia> {
    this.downloads.push(mediaId);
    const found = this.media.get(mediaId);
    if (!found) throw new MediaError("unavailable", `no fake media with id ${mediaId}`);
    if (opts.maxBytes !== undefined && found.data.length > opts.maxBytes) throw new MediaError("too_large", `media ${mediaId} is ${found.data.length} bytes, limit ${opts.maxBytes}`);
    return { ...found, data: Buffer.from(found.data) };
  }

  /** Messages sent to one recipient, oldest first. */
  to(waId: string): OutboundMessage[] {
    return this.sent.filter((s) => s.target.to === waId).map((s) => s.message);
  }

  clear(): void {
    this.sent.length = 0;
    this.downloads.length = 0;
  }
}

/** Prints outbound messages to stdout. Handy for running the API without a WhatsApp number. */
export class LoggingSender implements MessageSender {
  private counter = 0;
  constructor(private readonly log: (line: string) => void = (l) => console.log(l)) {}

  async send(target: SendTarget, message: OutboundMessage): Promise<SendResult> {
    this.log(`[outbound to ${target.to}] ${JSON.stringify(message)}`);
    return { providerMessageId: `wamid.log.${++this.counter}` };
  }

  async markRead(): Promise<void> {}

  /** Nothing to fetch from: there is no Meta behind this sender. */
  async downloadMedia(mediaId: string): Promise<DownloadedMedia> {
    this.log(`[media ${mediaId}] not downloaded: WHATSAPP_SENDER=log`);
    throw new MediaError("unavailable", "media download is off with WHATSAPP_SENDER=log");
  }
}
