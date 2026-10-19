import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { WEEKDAYS } from "@ordr/domain";
import { z } from "zod";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.service";
import type { ResourceRepository } from "../ports";
import { TOKENS } from "../tokens";

const LocalizedText = z
  .record(z.string().min(2).max(8), z.string().trim().max(100))
  .transform((t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v.length > 0)))
  .refine((t) => Object.keys(t).length > 0, "at least one language is required");

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");
const Range = z.object({ start: Time, end: Time }).refine((r) => r.start < r.end, "start must be before end");
const Hours = z.object(Object.fromEntries(WEEKDAYS.map((d) => [d, z.array(Range).max(4).optional()])) as Record<(typeof WEEKDAYS)[number], z.ZodOptional<z.ZodArray<typeof Range>>>);

const ResourceSchema = z.object({
  name: LocalizedText,
  type: z.enum(["staff", "room", "asset"]).optional(),
  hours: Hours.optional(),
  skills: z.array(z.string().min(1).max(100)).max(200).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
});

function requireOwner(user: AuthUser): void {
  if (user.role !== "owner") throw new ForbiddenException("only owners can manage the team");
}

/** Staff, rooms and assets that bookings occupy, with their weekly hours and the services they can do. */
@Controller("merchant/resources")
@UseGuards(AuthGuard)
export class MerchantResourcesController {
  constructor(@Inject(TOKENS.ResourceRepository) private readonly resources: ResourceRepository) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.resources.list(user.tenantId, { includeInactive: true }).then((resources) => ({ resources }));
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    requireOwner(user);
    const parsed = ResourceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    return this.resources.create(user.tenantId, parsed.data);
  }

  @Patch(":id")
  async update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    requireOwner(user);
    const parsed = ResourceSchema.partial().safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const updated = await this.resources.update(user.tenantId, id, parsed.data);
    if (!updated) throw new NotFoundException("resource not found");
    return updated;
  }
}
