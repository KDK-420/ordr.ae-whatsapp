import webPush from "web-push";
import type { AppConfig } from "../config";

export interface PushPayload {
  title: string;
  body: string;
  /** Path on the dashboard to open on tap. */
  url: string;
  /** Collapses repeated notifications about the same thread. */
  tag?: string;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Thrown by a sender when the push service answered with an error; 404 and 410 mean the subscription is gone. */
export class PushSendError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "PushSendError";
  }
}

/** What the push handler needs from the transport, so tests swap in a fake. */
export interface WebPushSender {
  readonly enabled: boolean;
  /** The VAPID public key the browser subscribes with; undefined when push is off. */
  readonly publicKey?: string;
  send(target: PushTarget, payload: PushPayload): Promise<void>;
}

/** Sends through the `web-push` library with the configured VAPID keys. */
export class VapidWebPushSender implements WebPushSender {
  readonly enabled: boolean;
  readonly publicKey?: string;
  private readonly privateKey?: string;

  constructor(private readonly config: Pick<AppConfig, "WEB_PUSH_PUBLIC_KEY" | "WEB_PUSH_PRIVATE_KEY" | "WEB_PUSH_SUBJECT">) {
    this.enabled = !!config.WEB_PUSH_PUBLIC_KEY && !!config.WEB_PUSH_PRIVATE_KEY;
    this.publicKey = this.enabled ? config.WEB_PUSH_PUBLIC_KEY : undefined;
    this.privateKey = this.enabled ? config.WEB_PUSH_PRIVATE_KEY : undefined;
  }

  async send(target: PushTarget, payload: PushPayload): Promise<void> {
    if (!this.publicKey || !this.privateKey) throw new PushSendError(0, "web push is not configured");
    try {
      await webPush.sendNotification({ endpoint: target.endpoint, keys: target.keys }, JSON.stringify(payload), {
        vapidDetails: { subject: this.config.WEB_PUSH_SUBJECT, publicKey: this.publicKey, privateKey: this.privateKey },
        TTL: 60 * 60,
        urgency: "high",
      });
    } catch (err) {
      const e = err as { statusCode?: number; body?: string; message?: string };
      throw new PushSendError(e.statusCode ?? 0, e.body?.trim() || e.message || String(err));
    }
  }
}

/** Records sends and fails the endpoints told to, for tests. */
export class FakeWebPushSender implements WebPushSender {
  readonly enabled = true;
  readonly publicKey = "BFakePublicKey";
  readonly sent: Array<{ target: PushTarget; payload: PushPayload }> = [];
  /** endpoint -> HTTP status the push service "answers" with */
  readonly failWith = new Map<string, number>();

  async send(target: PushTarget, payload: PushPayload): Promise<void> {
    const status = this.failWith.get(target.endpoint);
    if (status) throw new PushSendError(status, `push service answered ${status}`);
    this.sent.push({ target, payload });
  }
}

export const generateVapidKeys = (): { publicKey: string; privateKey: string } => webPush.generateVAPIDKeys();
