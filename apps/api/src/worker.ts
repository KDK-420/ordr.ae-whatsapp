import "reflect-metadata";
import { resolve } from "node:path";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { config as loadEnv } from "dotenv";
import { AppModule } from "./app.module";
import { loadConfig } from "./config";
import { OutboxRelay } from "./events/outbox-relay";
import { MaintenanceService } from "./maintenance.service";

loadEnv({ path: [resolve(__dirname, "../../../.env"), resolve(process.cwd(), ".env")] });

/**
 * Worker process: same code and adapters as the API, no HTTP. Relays outbox events to their
 * handlers (order notifications today). Start with `node dist/worker.js`.
 */
async function bootstrap(): Promise<void> {
  const config = loadConfig();
  if (config.storage !== "prisma") {
    Logger.error("the worker needs Postgres (DATABASE_URL); in memory mode events are handled inside the API process", "Worker");
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(AppModule.register({ config, role: "worker" }));
  app.enableShutdownHooks();
  const relay = app.get(OutboxRelay);
  relay.start();
  const maintenance = app.get(MaintenanceService);
  maintenance.start();
  Logger.log(`worker running (storage=${config.storage}, sender=${config.WHATSAPP_SENDER})`, "Worker");

  const shutdown = async (signal: string) => {
    Logger.log(`${signal} received, finishing the current batch`, "Worker");
    maintenance.stop();
    await relay.stop();
    await app.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

void bootstrap();
