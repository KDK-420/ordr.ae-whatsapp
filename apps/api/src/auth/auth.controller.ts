import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import type { AppConfig } from "../config";
import type { BlueprintRegistry, TenantRepository } from "../ports";
import { TOKENS } from "../tokens";
import { AuthGuard, CurrentUser, SESSION_COOKIE } from "./auth.guard";
import { AuthService, type AuthUser } from "./auth.service";

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

const isSecure = (req: Request): boolean => req.secure || req.headers["x-forwarded-proto"] === "https";

@Controller("merchant")
export class AuthController {
  constructor(
    @Inject(TOKENS.Config) private readonly config: AppConfig,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(TOKENS.TenantRepository) private readonly tenants: TenantRepository,
    @Inject(TOKENS.BlueprintRegistry) private readonly blueprints: BlueprintRegistry,
  ) {}

  /** Returns the token in the body and also sets it as an httpOnly cookie for the dashboard. */
  @Post("auth/login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("email and password are required");
    const session = await this.auth.login(parsed.data.email, parsed.data.password);
    res.cookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecure(req),
      path: "/",
      maxAge: this.config.AUTH_TOKEN_TTL_SECONDS * 1000,
    });
    return session;
  }

  @Post("auth/logout")
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  @Get("me")
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: AuthUser) {
    const tenant = await this.tenants.findById(user.tenantId);
    const blueprint = tenant ? this.blueprints.get(tenant.blueprintId) : undefined;
    return {
      user,
      tenant: tenant
        ? {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            blueprintId: tenant.blueprintId,
            defaultLanguage: tenant.defaultLanguage,
            timezone: tenant.timezone,
            /** Dashboard sections this vertical uses, from the blueprint (e.g. "calendar", "resources"). */
            modules: blueprint?.dashboardModules ?? [],
          }
        : null,
    };
  }
}
