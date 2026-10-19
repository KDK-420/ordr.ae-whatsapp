import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.service";
import { MerchantOrdersService } from "./merchant-orders.service";

const MAX_RANGE_MS = 62 * 24 * 60 * 60 * 1000;

/** Bookings for the calendar: everything scheduled in a window, with the resources it is laid out by. */
@Controller("merchant/bookings")
@UseGuards(AuthGuard)
export class MerchantBookingsController {
  constructor(@Inject(MerchantOrdersService) private readonly orders: MerchantOrdersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query("from") from?: string, @Query("to") to?: string) {
    const start = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = to ? new Date(to) : new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new BadRequestException("from and to must be ISO dates");
    if (end <= start || end.getTime() - start.getTime() > MAX_RANGE_MS) throw new BadRequestException("to must be after from, at most two months later");
    return this.orders.bookings(user.tenantId, start, end);
  }
}
