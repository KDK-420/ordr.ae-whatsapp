import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.service";
import type { PropertyRepository } from "../ports";
import { TOKENS } from "../tokens";

const LocalizedText = z
  .record(z.string().min(2).max(8), z.string().trim().max(200))
  .transform((t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v.length > 0)))
  .refine((t) => Object.keys(t).length > 0, "at least one language is required");

const OptionalText = z
  .record(z.string().min(2).max(8), z.string().trim().max(1000))
  .transform((t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v.length > 0)))
  .transform((t) => (Object.keys(t).length ? t : null))
  .nullable();

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");
const Url = z.union([z.string().trim().url().max(500), z.literal("")]).transform((v) => v || null);

const PropertySchema = z.object({
  name: LocalizedText,
  description: OptionalText.optional(),
  address: z.string().trim().max(300).optional().nullable(),
  mapsUrl: Url.optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  checkInTime: Time.optional(),
  checkOutTime: Time.optional(),
  amenities: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  imageUrls: z.array(z.string().trim().url().max(500)).max(10).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
});

function requireOwner(user: AuthUser): void {
  if (user.role !== "owner") throw new ForbiddenException("only owners can manage properties");
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const res = schema.safeParse(body);
  if (!res.success) throw new BadRequestException(res.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return res.data;
}

/** The resorts, hotels or venues a tenant runs from one WhatsApp number; room types in the catalog point at one of them. */
@Controller("merchant/properties")
@UseGuards(AuthGuard)
export class MerchantPropertiesController {
  constructor(@Inject(TOKENS.PropertyRepository) private readonly properties: PropertyRepository) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.properties.list(user.tenantId, { includeInactive: true }).then((properties) => ({ properties }));
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    requireOwner(user);
    return this.properties.create(user.tenantId, parse(PropertySchema, body));
  }

  @Patch(":id")
  async update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    requireOwner(user);
    const updated = await this.properties.update(user.tenantId, id, parse(PropertySchema.partial(), body));
    if (!updated) throw new NotFoundException("property not found");
    return updated;
  }
}
