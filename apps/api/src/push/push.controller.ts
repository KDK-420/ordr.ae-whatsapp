import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Post, Req, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.service";
import type { PushSubscriptionRepository } from "../ports";
import { TOKENS } from "../tokens";
import type { WebPushSender } from "./web-push";

/** The PushSubscription.toJSON() shape browsers produce. */
const SubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(200) }),
});
const UnsubscribeSchema = z.object({ endpoint: z.string().url().max(2000) });

/** A dashboard device registering for "needs a person" pushes. Subscriptions belong to the signed-in user. */
@Controller("merchant/push")
@UseGuards(AuthGuard)
export class MerchantPushController {
  constructor(
    @Inject(TOKENS.WebPushSender) private readonly sender: WebPushSender,
    @Inject(TOKENS.PushSubscriptionRepository) private readonly subscriptions: PushSubscriptionRepository,
  ) {}

  /** 503 when the server has no VAPID keys, so the toggle can say push is off rather than fail later. */
  @Get("public-key")
  publicKey() {
    if (!this.sender.enabled || !this.sender.publicKey) throw new ServiceUnavailableException("push notifications are not configured on this server");
    return { publicKey: this.sender.publicKey };
  }

  @Post("subscribe")
  async subscribe(@CurrentUser() user: AuthUser, @Body() body: unknown, @Req() req: Request) {
    if (!this.sender.enabled) throw new ServiceUnavailableException("push notifications are not configured on this server");
    const parsed = SubscribeSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("endpoint and keys are required");
    const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 300) : undefined;
    const row = await this.subscriptions.upsert({ userId: user.id, tenantId: user.tenantId, endpoint: parsed.data.endpoint, keys: parsed.data.keys, userAgent });
    return { id: row.id, endpoint: row.endpoint, createdAt: row.createdAt.toISOString() };
  }

  @Delete("subscribe")
  @HttpCode(204)
  async unsubscribe(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<void> {
    const parsed = UnsubscribeSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("endpoint is required");
    await this.subscriptions.removeByEndpoint(parsed.data.endpoint, user.id);
  }
}
