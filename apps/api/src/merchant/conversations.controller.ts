import { BadGatewayException, BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Res, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { AssistantUnavailableError } from "../ai/assistant";
import { AssistantService } from "../ai/assistant.service";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.service";
import { InboxError, InboxService } from "../inbox/inbox.service";
import type { ConversationStatus } from "../ports";

const ReplySchema = z.object({ text: z.string().trim().min(1).max(4096) });
const StatusSchema = z.object({ status: z.enum(["bot", "human", "closed"]) });
const DraftSchema = z.object({ instruction: z.string().trim().max(1000).optional() });
const STATUSES: ConversationStatus[] = ["bot", "human", "closed"];

function rethrow(err: unknown): never {
  if (err instanceof InboxError) {
    if (err.code === "not_found") throw new NotFoundException(err.message);
    if (err.code === "window_closed") throw new ConflictException(err.message);
    throw new BadGatewayException(err.message);
  }
  throw err;
}

@Controller("merchant/conversations")
@UseGuards(AuthGuard)
export class MerchantConversationsController {
  constructor(
    @Inject(InboxService) private readonly inbox: InboxService,
    @Inject(AssistantService) private readonly assistant: AssistantService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query("status") status?: string) {
    const s = (STATUSES as string[]).includes(status ?? "") ? (status as ConversationStatus) : undefined;
    return this.inbox.list(user.tenantId, s).then((conversations) => ({ conversations }));
  }

  @Get(":id")
  thread(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.inbox.thread(user.tenantId, id).catch(rethrow);
  }

  /** The image, voice note or file behind an inbound media message, for the inbox to show. */
  @Get(":id/media/:messageId")
  async media(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("messageId") messageId: string, @Res() res: Response) {
    const media = await this.inbox.media(user.tenantId, id, messageId).catch(rethrow);
    res.setHeader("content-type", media.mimeType);
    res.setHeader("cache-control", "private, max-age=3600");
    res.send(media.data);
  }

  @Post(":id/messages")
  @HttpCode(201)
  reply(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const parsed = ReplySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("text is required");
    return this.inbox.reply(user.tenantId, id, parsed.data.text, `user:${user.email}`).catch(rethrow);
  }

  /** A reply drafted by the assistant for the agent to edit and send. */
  @Post(":id/draft")
  @HttpCode(200)
  async draft(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const parsed = DraftSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException("instruction must be a short text");
    if (!this.assistant.enabled) throw new ServiceUnavailableException("AI assistant is not configured");
    await this.inbox.thread(user.tenantId, id).catch(rethrow);
    try {
      return { text: await this.assistant.draftReply(user.tenantId, id, parsed.data.instruction) };
    } catch (err) {
      if (err instanceof AssistantUnavailableError) throw new ServiceUnavailableException(err.message);
      throw new BadGatewayException(err instanceof Error ? err.message : "draft failed");
    }
  }

  @Post(":id/status")
  @HttpCode(200)
  setStatus(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const parsed = StatusSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("status must be bot, human or closed");
    return this.inbox.setStatus(user.tenantId, id, parsed.data.status).catch(rethrow);
  }
}
