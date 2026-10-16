import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** scrypt parameters; the string format records N so they can change later without rehashing everyone at once. */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

/** Returns "scrypt$N$salt$hash" with salt and hash base64url encoded. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return `scrypt$${N}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, Buffer.from(salt, "base64url"), expected.length, { N: Number(n), r: R, p: P });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
