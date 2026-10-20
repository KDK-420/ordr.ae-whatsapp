import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, NotFoundException, Param, Post, UnauthorizedException } from "@nestjs/common";
import { z } from "zod";
import { WebChatError, WebChatService } from "./webchat.service";

const StartSchema = z.object({ slug: z.string().min(1).max(80), name: z.string().max(80).optional(), language: z.enum(["en", "ar"]).optional() });
const SendSchema = z.object({ text: z.string().min(1).max(2000), clientMessageId: z.string().max(64).optional() });

/**
 * Public web chat. No merchant auth: a session token (returned once at start) authorizes the
 * visitor for their own session only. Everything else goes through the same pipeline as WhatsApp.
 */
@Controller("v1/chat")
export class WebChatController {
  constructor(@Inject(WebChatService) private readonly chat: WebChatService) {}

  @Post("sessions")
  @HttpCode(201)
  async start(@Body() body: unknown) {
    const parsed = StartSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => i.message).join("; "));
    try {
      const { token, view } = await this.chat.start(parsed.data.slug, { name: parsed.data.name, language: parsed.data.language });
      return { token, ...view };
    } catch (err) {
      throw translate(err);
    }
  }

  @Get("sessions/:id")
  async thread(@Param("id") id: string, @Headers("authorization") auth: string | undefined) {
    try {
      const session = await this.chat.authenticate(id, bearer(auth));
      return this.chat.thread(session);
    } catch (err) {
      throw translate(err);
    }
  }

  @Post("sessions/:id/messages")
  @HttpCode(200)
  async send(@Param("id") id: string, @Headers("authorization") auth: string | undefined, @Body() body: unknown) {
    const parsed = SendSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => i.message).join("; "));
    try {
      const session = await this.chat.authenticate(id, bearer(auth));
      return await this.chat.send(session, parsed.data);
    } catch (err) {
      throw translate(err);
    }
  }
}

function bearer(header: string | undefined): string | undefined {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return m?.[1]?.trim();
}

function translate(err: unknown): Error {
  if (err instanceof WebChatError) {
    if (err.code === "not_found") return new NotFoundException(err.message);
    if (err.code === "unauthorized") return new UnauthorizedException(err.message);
    return new BadRequestException(err.message);
  }
  return err instanceof Error ? err : new Error(String(err));
}
