import { randomBytes } from "node:crypto";
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.service";
import { hashPassword, verifyPassword } from "../auth/password";
import type { UserRecord, UserRepository } from "../ports";
import { TOKENS } from "../tokens";

const CreateSchema = z.object({ email: z.string().email().max(200), name: z.string().trim().min(1).max(100), role: z.enum(["owner", "staff"]).default("staff") });
const PatchSchema = z.object({ name: z.string().trim().min(1).max(100).optional(), role: z.enum(["owner", "staff"]).optional(), isActive: z.boolean().optional() });
const PasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) });

/** 14 characters from an unambiguous alphabet; shown once to the owner who created the account. */
export function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const publicUser = (u: UserRecord) => ({ id: u.id, email: u.email, name: u.name, role: u.role, isActive: u.isActive });

function requireOwner(user: AuthUser): void {
  if (user.role !== "owner") throw new ForbiddenException("only owners can manage staff");
}

@Controller("merchant")
@UseGuards(AuthGuard)
export class MerchantUsersController {
  constructor(@Inject(TOKENS.UserRepository) private readonly users: UserRepository) {}

  @Get("users")
  async list(@CurrentUser() user: AuthUser) {
    requireOwner(user);
    return { users: (await this.users.listByTenant(user.tenantId)).map(publicUser) };
  }

  /** Creates a staff or owner account and returns its temporary password once. */
  @Post("users")
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    requireOwner(user);
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("email, name and role are required");
    if (await this.users.findByEmail(parsed.data.email)) throw new ConflictException("an account with this email already exists");
    const password = temporaryPassword();
    const created = await this.users.create({ tenantId: user.tenantId, email: parsed.data.email, name: parsed.data.name, role: parsed.data.role, passwordHash: hashPassword(password) });
    return { user: publicUser(created), temporaryPassword: password };
  }

  @Patch("users/:id")
  async update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    requireOwner(user);
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("invalid fields");
    const target = await this.sameTenant(user, id);
    if (target.id === user.id && (parsed.data.isActive === false || (parsed.data.role && parsed.data.role !== "owner"))) {
      throw new BadRequestException("you cannot deactivate or demote your own account");
    }
    const updated = await this.users.update(id, parsed.data);
    return publicUser(updated!);
  }

  @Post("users/:id/reset-password")
  @HttpCode(200)
  async resetPassword(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    requireOwner(user);
    await this.sameTenant(user, id);
    const password = temporaryPassword();
    await this.users.update(id, { passwordHash: hashPassword(password) });
    return { temporaryPassword: password };
  }

  @Post("me/password")
  @HttpCode(204)
  async changePassword(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<void> {
    const parsed = PasswordSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("currentPassword and a newPassword of at least 8 characters are required");
    const record = await this.users.findById(user.id);
    if (!record || !verifyPassword(parsed.data.currentPassword, record.passwordHash)) throw new ForbiddenException("current password is wrong");
    await this.users.update(user.id, { passwordHash: hashPassword(parsed.data.newPassword) });
  }

  private async sameTenant(user: AuthUser, id: string): Promise<UserRecord> {
    const target = await this.users.findById(id);
    if (!target || target.tenantId !== user.tenantId) throw new NotFoundException("user not found");
    return target;
  }
}
