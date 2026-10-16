import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { InvalidTransitionError } from "@ordr/domain";
import { z } from "zod";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.service";
import { OrderError } from "../orders/order.service";
import { MerchantOrdersService, type OrderScope } from "./merchant-orders.service";

const TransitionSchema = z.object({ event: z.string().min(1).max(40) });
const SCOPES: OrderScope[] = ["board", "active", "all"];

@Controller("merchant/orders")
@UseGuards(AuthGuard)
export class MerchantOrdersController {
  constructor(@Inject(MerchantOrdersService) private readonly orders: MerchantOrdersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query("scope") scope?: string, @Query("limit") limit?: string) {
    const s = (SCOPES as string[]).includes(scope ?? "") ? (scope as OrderScope) : "board";
    const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.orders.list(user.tenantId, s, n);
  }

  @Get(":id")
  async get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const order = await this.orders.get(user.tenantId, id);
    if (!order) throw new NotFoundException("order not found");
    return order;
  }

  /** Applies a blueprint event such as "accept", "start", "ready", "dispatch", "deliver", "complete", "reject" or "cancel". */
  @Post(":id/transition")
  @HttpCode(200)
  async transition(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const parsed = TransitionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("event is required");
    try {
      return await this.orders.transition(user.tenantId, id, parsed.data.event, `user:${user.email}`);
    } catch (err) {
      if (err instanceof InvalidTransitionError) throw new ConflictException(err.message);
      if (err instanceof OrderError && /not found/.test(err.message)) throw new NotFoundException(err.message);
      throw err;
    }
  }
}
