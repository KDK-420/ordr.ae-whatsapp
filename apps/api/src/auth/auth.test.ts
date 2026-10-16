import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";
import { signToken, verifyToken } from "./token";

describe("password hashing", () => {
  it("verifies the right password and rejects others", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(stored.startsWith("scrypt$16384$")).toBe(true);
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassword("correct horse battery stapl", stored)).toBe(false);
    expect(verifyPassword("anything", "garbage")).toBe(false);
  });

  it("salts every hash", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });
});

describe("session tokens", () => {
  const claims = { sub: "usr_1", tenantId: "tenant_1", role: "owner", email: "owner@example.com" };

  it("round-trips claims and enforces expiry", () => {
    const now = Date.parse("2026-10-16T00:00:00Z");
    const token = signToken(claims, "secret-secret-secret", 60, now);
    expect(verifyToken(token, "secret-secret-secret", now + 30_000)).toMatchObject(claims);
    expect(verifyToken(token, "secret-secret-secret", now + 61_000)).toBeNull();
  });

  it("rejects tampering and the wrong secret", () => {
    const token = signToken(claims, "secret-secret-secret", 60);
    const [v, payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, tenantId: "someone-else", iat: 0, exp: 4102444800 })).toString("base64url");
    expect(verifyToken(`${v}.${forged}.${sig}`, "secret-secret-secret")).toBeNull();
    expect(verifyToken(`${v}.${payload}.${sig}`, "another-secret-value")).toBeNull();
    expect(verifyToken("nonsense", "secret-secret-secret")).toBeNull();
  });
});
