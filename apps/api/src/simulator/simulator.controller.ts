import { BadGatewayException, BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import type { InboundContent } from "@ordr/whatsapp";
import { z } from "zod";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.service";
import { InboxError } from "../inbox/inbox.service";
import { SimulatorService } from "./simulator.service";

const CreateSchema = z.object({ name: z.string().trim().min(1).max(60) });

const ContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().trim().min(1).max(4096) }),
  z.object({ kind: z.literal("button"), id: z.string().min(1).max(256), title: z.string().max(20).default("") }),
  z.object({ kind: z.literal("list"), id: z.string().min(1).max(200), title: z.string().max(24).default(""), description: z.string().max(72).optional() }),
  z.object({ kind: z.literal("location"), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), name: z.string().max(100).optional(), address: z.string().max(200).optional() }),
]);

function rethrow(err: unknown): never {
  if (err instanceof InboxError) {
    if (err.code === "not_found") throw new NotFoundException(err.message);
    throw new BadGatewayException(err.message);
  }
  throw err;
}

/**
 * The demo page: fake customers talk to the real bot. Everything here is tenant-scoped through
 * the signed-in user and only touches customers whose WhatsApp id is synthetic.
 */
@Controller("merchant/simulator")
@UseGuards(AuthGuard)
export class MerchantSimulatorController {
  constructor(@Inject(SimulatorService) private readonly simulator: SimulatorService) {}

  @Get("customers")
  list(@CurrentUser() user: AuthUser) {
    return this.simulator.listCustomers(user.tenantId).then((customers) => ({ customers }));
  }

  @Post("customers")
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("name is required");
    return this.simulator.createCustomer(user.tenantId, parsed.data.name).catch(rethrow);
  }

  @Get("customers/:waId")
  thread(@CurrentUser() user: AuthUser, @Param("waId") waId: string) {
    return this.simulator.thread(user.tenantId, waId).catch(rethrow);
  }

  @Post("customers/:waId/messages")
  @HttpCode(200)
  send(@CurrentUser() user: AuthUser, @Param("waId") waId: string, @Body() body: unknown) {
    const parsed = ContentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("message must be text, a button or list reply, or a location");
    return this.simulator.send(user.tenantId, waId, parsed.data as InboundContent).catch(rethrow);
  }

  @Post("customers/:waId/reset")
  @HttpCode(200)
  reset(@CurrentUser() user: AuthUser, @Param("waId") waId: string) {
    return this.simulator.reset(user.tenantId, waId).catch(rethrow);
  }
}
