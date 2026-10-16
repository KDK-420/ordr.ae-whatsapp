import { BadGatewayException, BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.service";
import { InboxError, InboxService } from "../inbox/inbox.service";
import type { ConversationStatus } from "../ports";

const ReplySchema = z.object({ text: z.string().trim().min(1).max(4096) });
const StatusSchema = z.object({ status: z.enum(["bot", "human", "closed"]) });
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
  constructor(@Inject(InboxService) private readonly inbox: InboxService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query("status") status?: string) {
    const s = (STATUSES as string[]).includes(status ?? "") ? (status as ConversationStatus) : undefined;
    return this.inbox.list(user.tenantId, s).then((conversations) => ({ conversations }));
  }

  @Get(":id")
  thread(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.inbox.thread(user.tenantId, id).catch(rethrow);
  }

  @Post(":id/messages")
  @HttpCode(201)
  reply(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const parsed = ReplySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("text is required");
    return this.inbox.reply(user.tenantId, id, parsed.data.text, `user:${user.email}`).catch(rethrow);
  }

  @Post(":id/status")
  @HttpCode(200)
  setStatus(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const parsed = StatusSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("status must be bot, human or closed");
    return this.inbox.setStatus(user.tenantId, id, parsed.data.status).catch(rethrow);
  }
}
