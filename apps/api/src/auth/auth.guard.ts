import { type CanActivate, createParamDecorator, type ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { AuthService, type AuthUser } from "./auth.service";

/** Cookie set by the login endpoint; the dashboard relies on it, API clients may send a Bearer token instead. */
export const SESSION_COOKIE = "ordr_session";

export type AuthenticatedRequest = Request & { user?: AuthUser };

export function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  const cookies = req.headers.cookie;
  if (!cookies) return undefined;
  for (const part of cookies.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractToken(req);
    const user = token ? await this.auth.authenticate(token) : null;
    if (!user) throw new UnauthorizedException("sign in required");
    req.user = user;
    return true;
  }
}

/** The signed-in user, populated by AuthGuard. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!req.user) throw new UnauthorizedException("sign in required");
  return req.user;
});
