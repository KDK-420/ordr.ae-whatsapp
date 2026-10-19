import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { blueprints } from "@ordr/blueprints";
import { z } from "zod";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.service";
import { AdminError, AdminService } from "./admin.service";

const CreateTenantSchema = z.object({
  name: z.string().trim().min(2).max(80),
  blueprintId: z.string().min(1).max(40),
  ownerEmail: z.string().email().max(200),
  ownerName: z.string().trim().min(1).max(100),
  defaultLanguage: z.enum(["en", "ar"]).optional(),
  timezone: z.string().min(3).max(60).optional(),
  numberId: z.string().min(1).optional(),
  seedDemo: z.boolean().optional(),
});

const AddNumberSchema = z.object({
  phoneNumberId: z.string().trim().min(5).max(40),
  wabaId: z.string().trim().min(5).max(40),
  displayPhone: z.string().trim().regex(/^\+?[0-9 ]{7,20}$/, "international format, e.g. +971500000000"),
  accessToken: z.string().trim().min(20).max(1000),
  label: z.string().trim().max(80).optional(),
});

const AssignSchema = z.object({ tenantId: z.string().min(1) });

function requirePlatformAdmin(user: AuthUser): void {
  if (!user.platformAdmin) throw new ForbiddenException("platform admins only");
}

function rethrow(err: unknown): never {
  if (err instanceof AdminError) {
    if (err.code === "not_found") throw new NotFoundException(err.message);
    if (err.code === "conflict") throw new ConflictException(err.message);
    throw new BadRequestException(err.message);
  }
  throw err;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}

/** Platform operator console: tenants and the WhatsApp number pool. */
@Controller("admin")
@UseGuards(AuthGuard)
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get("overview")
  async overview(@CurrentUser() user: AuthUser) {
    requirePlatformAdmin(user);
    const [tenants, numbers] = await Promise.all([this.admin.listTenants(), this.admin.listNumbers()]);
    return {
      tenants,
      numbers: numbers.map(publicNumber),
      verticals: Object.values(blueprints).map((b) => ({ id: b.id, name: b.description ?? b.id, languages: b.languages })),
    };
  }

  @Post("tenants")
  @HttpCode(201)
  createTenant(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    requirePlatformAdmin(user);
    return this.admin.createTenant(parse(CreateTenantSchema, body)).catch(rethrow);
  }

  @Post("tenants/:tenantId/owners/:userId/reset-password")
  @HttpCode(200)
  resetOwnerPassword(@CurrentUser() user: AuthUser, @Param("tenantId") tenantId: string, @Param("userId") userId: string) {
    requirePlatformAdmin(user);
    return this.admin.resetOwnerPassword(tenantId, userId).catch(rethrow);
  }

  @Post("numbers")
  @HttpCode(201)
  addNumber(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    requirePlatformAdmin(user);
    return this.admin
      .addNumber(parse(AddNumberSchema, body))
      .then(publicNumber)
      .catch(rethrow);
  }

  @Post("numbers/:id/assign")
  @HttpCode(200)
  assign(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    requirePlatformAdmin(user);
    return this.admin
      .assignNumber(id, parse(AssignSchema, body).tenantId)
      .then(publicNumber)
      .catch(rethrow);
  }

  @Post("numbers/:id/release")
  @HttpCode(200)
  release(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    requirePlatformAdmin(user);
    return this.admin.releaseNumber(id).then(publicNumber).catch(rethrow);
  }
}

/** Never returns the access token. */
const publicNumber = (n: { id: string; phoneNumberId: string; wabaId: string; displayPhone: string; label?: string; tenantId: string | null; createdAt: string }) => ({
  id: n.id,
  phoneNumberId: n.phoneNumberId,
  wabaId: n.wabaId,
  displayPhone: n.displayPhone,
  label: n.label,
  tenantId: n.tenantId,
  createdAt: n.createdAt,
});
