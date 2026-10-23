import { generateVapidKeys } from "../push/web-push";

/** Prints a fresh VAPID key pair for .env / deploy/.env (`pnpm --filter @ordr/api push:keys`). */
const keys = generateVapidKeys();
process.stdout.write(`WEB_PUSH_PUBLIC_KEY=${keys.publicKey}\nWEB_PUSH_PRIVATE_KEY=${keys.privateKey}\n`);
