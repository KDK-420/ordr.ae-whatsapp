import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  META_APP_SECRET: z.string().min(1),
  META_VERIFY_TOKEN: z.string().min(1),
  META_GRAPH_VERSION: z.string().default("v23.0"),
  WHATSAPP_SENDER: z.enum(["meta", "log"]).default("meta"),
  /** memory: everything in process (dev and tests). prisma: Postgres, plus Redis when REDIS_URL is set. */
  STORAGE: z.enum(["memory", "prisma"]).optional(),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(24 * 60 * 60),
  DEDUPE_TTL_SECONDS: z.coerce.number().int().positive().default(7 * 24 * 60 * 60),
  SEED_TENANT_NAME: z.string().default("Demo Restaurant"),
  SEED_BLUEPRINT_ID: z.string().default("restaurant"),
  SEED_PHONE_NUMBER_ID: z.string().default("000000000000000"),
  SEED_WABA_ID: z.string().default("000000000000000"),
  SEED_DISPLAY_PHONE: z.string().default("+971500000000"),
  SEED_ACCESS_TOKEN: z.string().default("replace-me"),
  /** Signs dashboard session tokens. Falls back to META_APP_SECRET when unset. */
  AUTH_SECRET: z.string().min(16).optional(),
  AUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(7 * 24 * 60 * 60),
  /** First dashboard login for the seed tenant; created by `pnpm db:seed` and in memory mode. */
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
  SEED_ADMIN_NAME: z.string().default("Owner"),
  /** Claude assistant for free text, option matching and agent drafts. Off when the key is missing. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  /**
   * Speech to text for WhatsApp voice notes. "none" (the only value today) leaves them untranscribed;
   * the agent then asks the customer to type. A provider adapter adds its name here and reads TRANSCRIPTION_API_KEY.
   */
  TRANSCRIPTION_PROVIDER: z.enum(["none"]).default("none"),
  TRANSCRIPTION_API_KEY: z.string().min(1).optional(),
  /** Where the dashboard (web chat, mock checkout page) is reachable by customers. */
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3001"),
  /** "mock" ships a hosted-looking checkout page that signs its own webhook; real providers plug in behind the same port. */
  PAYMENT_PROVIDER: z.enum(["mock"]).default("mock"),
  /** Signs and verifies payment webhooks. Falls back to AUTH_SECRET / META_APP_SECRET. */
  PAYMENT_WEBHOOK_SECRET: z.string().min(16).optional(),
  /** How long a held slot or a checkout stays reserved. */
  HOLD_MINUTES: z.coerce.number().int().positive().default(10),
  CHECKOUT_MINUTES: z.coerce.number().int().positive().default(30),
  /** Default retention for remembered preferences. */
  MEMORY_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  /** Worker: how often to look for outbox events, how many to take, and when to give up on one. */
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(25),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(12),
});

export type AppConfig = z.infer<typeof EnvSchema> & { storage: "memory" | "prisma" };

/** Env files often ship `KEY=` for optional values; an empty string means "not set", not "set to nothing". */
function withoutEmptyValues(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ""));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(withoutEmptyValues(env));
  const storage = parsed.STORAGE ?? (parsed.DATABASE_URL ? "prisma" : "memory");
  return { ...parsed, storage };
}
