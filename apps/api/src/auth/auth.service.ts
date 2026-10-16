import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { AppConfig } from "../config";
import type { UserRecord, UserRepository, UserRole } from "../ports";
import { TOKENS } from "../tokens";
import { hashPassword, verifyPassword } from "./password";
import { signToken, verifyToken } from "./token";

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface LoginResult {
  token: string;
  expiresAt: string;
  user: AuthUser;
}

/** Verified against when the email is unknown, so a failed login costs the same time either way. */
const DUMMY_HASH = hashPassword("not-a-real-password");

const publicUser = (u: UserRecord): AuthUser => ({ id: u.id, tenantId: u.tenantId, email: u.email, name: u.name, role: u.role });

@Injectable()
export class AuthService {
  constructor(
    @Inject(TOKENS.Config) private readonly config: AppConfig,
    @Inject(TOKENS.UserRepository) private readonly users: UserRepository,
  ) {}

  private get secret(): string {
    return this.config.AUTH_SECRET ?? this.config.META_APP_SECRET;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.users.findByEmail(email);
    const ok = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.isActive) throw new UnauthorizedException("invalid email or password");
    const ttl = this.config.AUTH_TOKEN_TTL_SECONDS;
    const token = signToken({ sub: user.id, tenantId: user.tenantId, role: user.role, email: user.email }, this.secret, ttl);
    await this.users.touchLogin(user.id, new Date());
    return { token, expiresAt: new Date(Date.now() + ttl * 1000).toISOString(), user: publicUser(user) };
  }

  /** Resolves a token to its user, or null when the token is invalid, expired, or the user is gone. */
  async authenticate(token: string): Promise<AuthUser | null> {
    const claims = verifyToken(token, this.secret);
    if (!claims) return null;
    const user = await this.users.findById(claims.sub);
    if (!user || !user.isActive) return null;
    return publicUser(user);
  }
}
