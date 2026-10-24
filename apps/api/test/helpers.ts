import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FakeSender, fixtures } from "@ordr/whatsapp";
import { InMemoryConversationRepository, InMemoryDedupeStore, InMemorySessionStore, InMemoryTenantRepository } from "../src/adapters/memory";
import { InMemoryEventBus, InMemoryOrderRepository } from "../src/adapters/memory-catalog";
import { AppModule, seedTenantFromConfig } from "../src/app.module";
import { type AppConfig, loadConfig } from "../src/config";
import { ConversationService } from "../src/conversation/conversation.service";
import { InboundQueue } from "../src/conversation/inbound-queue";

export const TEST_SECRET = "test-app-secret";
export const TEST_VERIFY_TOKEN = "test-verify-token";

export function testConfig(): AppConfig {
  return loadConfig({
    META_APP_SECRET: TEST_SECRET,
    META_VERIFY_TOKEN: TEST_VERIFY_TOKEN,
    STORAGE: "memory",
    WHATSAPP_SENDER: "log",
    SEED_PHONE_NUMBER_ID: "200000000000000",
  });
}

export interface Harness {
  app: INestApplication;
  config: AppConfig;
  sender: FakeSender;
  conversations: InMemoryConversationRepository;
  tenants: InMemoryTenantRepository;
  sessions: InMemorySessionStore;
  orders: InMemoryOrderRepository;
  eventBus: InMemoryEventBus;
  service: ConversationService;
  queue: InboundQueue;
  base: fixtures.FixtureBase;
}

export async function createHarness(): Promise<Harness> {
  const config = testConfig();
  const sender = new FakeSender();
  const conversations = new InMemoryConversationRepository();
  const sessions = new InMemorySessionStore();
  const tenants = new InMemoryTenantRepository([seedTenantFromConfig(config)]);
  const orders = new InMemoryOrderRepository();
  const eventBus = new InMemoryEventBus();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ config, overrides: { sender, conversations, sessions, tenants, orders, eventBus, dedupe: new InMemoryDedupeStore() } })],
  }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  await app.init();
  return {
    app,
    config,
    sender,
    conversations,
    tenants,
    sessions,
    orders,
    eventBus,
    service: app.get(ConversationService),
    queue: app.get(InboundQueue),
    base: { phoneNumberId: config.SEED_PHONE_NUMBER_ID, from: "971500000001", profileName: "Sara" },
  };
}
