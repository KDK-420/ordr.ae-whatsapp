import { createHmac, timingSafeEqual } from "node:crypto";

/** Claims carried by a dashboard session token. */
export interface TokenClaims {
  /** User id. */
  sub: string;
  tenantId: string;
  role: string;
  email: string;
  /** Unix seconds. */
  iat: number;
  exp: number;
}

const VERSION = "v1";

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`${VERSION}.${payload}`).digest("base64url");
}

/** Compact HMAC-SHA256 token: "v1.<base64url claims>.<base64url signature>". */
export function signToken(claims: Omit<TokenClaims, "iat" | "exp">, secret: string, ttlSeconds: number, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ ...claims, iat, exp: iat + ttlSeconds })).toString("base64url");
  return `${VERSION}.${payload}.${signature(payload, secret)}`;
}

/** Returns the claims when the signature is valid and the token has not expired, otherwise null. */
export function verifyToken(token: string, secret: string, now = Date.now()): TokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const payload = parts[1] ?? "";
  const provided = Buffer.from(parts[2] ?? "");
  const expected = Buffer.from(signature(payload, secret));
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  let claims: Partial<TokenClaims>;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<TokenClaims>;
  } catch {
    return null;
  }
  if (typeof claims.sub !== "string" || typeof claims.tenantId !== "string" || typeof claims.exp !== "number") return null;
  if (claims.exp * 1000 <= now) return null;
  return claims as TokenClaims;
}
