import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const base = { META_APP_SECRET: "secret", META_VERIFY_TOKEN: "verify" };

describe("loadConfig", () => {
  it("treats empty optional values as unset, the way .env.example ships them", () => {
    const config = loadConfig({ ...base, ANTHROPIC_API_KEY: "", REDIS_URL: " ", DATABASE_URL: "" });
    expect(config.ANTHROPIC_API_KEY).toBeUndefined();
    expect(config.REDIS_URL).toBeUndefined();
    expect(config.storage).toBe("memory");
  });

  it("falls back to defaults for empty values that have one", () => {
    expect(loadConfig({ ...base, PORT: "", ANTHROPIC_MODEL: "" })).toMatchObject({ PORT: 3000, ANTHROPIC_MODEL: "claude-opus-5-5" });
  });

  it("still rejects a missing required secret", () => {
    expect(() => loadConfig({ ...base, META_APP_SECRET: "" })).toThrow();
  });
});
