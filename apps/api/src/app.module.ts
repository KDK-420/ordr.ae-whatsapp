import { type DynamicModule, Logger, Module, type Provider } from "@nestjs/common";
import { getBlueprint } from "@ordr/blueprints";
import type { ActionRegistry } from "@ordr/flow-schema";
import { CloudApiClient, LoggingSender, type MessageSender } from "@ordr/whatsapp";
import { demoCatalog } from "./actions/demo-catalog";
import { demoSalonCatalog } from "./actions/demo-salon";
import { createActionRegistry } from "./actions";
import { AnthropicAssistant } from "./ai/anthropic.assistant";
import { type Assistant, NoopAssistant } from "./ai/assistant";
import { AssistantService } from "./ai/assistant.service";
import { InMemoryConversationRepository, InMemoryDedupeStore, InMemorySessionStore, InMemoryTenantRepository, InMemoryUserRepository } from "./adapters/memory";
import { InMemoryCatalogRepository, InMemoryEventBus, InMemoryOrderRepository, InMemoryOutboxStore, InMemoryResourceRepository } from "./adapters/memory-catalog";
import { OutboxEventBus, PrismaOutboxStore } from "./adapters/outbox";
import { FakeTemplateApi, InMemoryTemplateRepository, PrismaTemplateRepository } from "./adapters/templates";
import { PrismaCatalogRepository, PrismaOrderRepository, PrismaResourceRepository } from "./adapters/prisma-catalog";
import {
  PrismaConversationRepository,
  PrismaDedupeStore,
  PrismaService,
  PrismaSessionStore,
  PrismaTenantRepository,
  PrismaUserRepository,
} from "./adapters/prisma";
import { createRedis, RedisDedupeStore, RedisSessionStore } from "./adapters/redis";
import { AuthController } from "./auth/auth.controller";
import { AuthGuard } from "./auth/auth.guard";
import { AuthService } from "./auth/auth.service";
import { hashPassword } from "./auth/password";
import type { AppConfig } from "./config";
import { ConversationService } from "./conversation/conversation.service";
import { InboundQueue } from "./conversation/inbound-queue";
import { OutboxRelay } from "./events/outbox-relay";
import { HealthController } from "./health.controller";
import { InboxService } from "./inbox/inbox.service";
import { MerchantCatalogController } from "./merchant/catalog.controller";
import { MerchantConversationsController } from "./merchant/conversations.controller";
import { MerchantUsersController } from "./merchant/users.controller";
import { MerchantOrdersService } from "./merchant/merchant-orders.service";
import { MerchantOrdersController } from "./merchant/orders.controller";
import { MerchantTemplatesController } from "./merchant/templates.controller";
import { OrderNotifier } from "./orders/order-notifier";
import { OrderService } from "./orders/order.service";
import { SchedulingService } from "./scheduling/scheduling.service";
import { MerchantSimulatorController } from "./simulator/simulator.controller";
import { DemoAwareSender, SimulatorService } from "./simulator/simulator.service";
import { TemplateService } from "./templates/template.service";
import type {
  BlueprintRegistry,
  CatalogRepository,
  ConversationRepository,
  DedupeStore,
  EventBus,
  OrderRepository,
  OutboxStore,
  ResourceRepository,
  SessionStore,
  TemplateApi,
  TemplateRepository,
  TenantContext,
  TenantRepository,
  UserRepository,
} from "./ports";
import { RootController } from "./root.controller";
import { TOKENS } from "./tokens";
import { WebhookController } from "./webhook/webhook.controller";

export interface AppOptions {
  config: AppConfig;
  /**
   * api: HTTP controllers; on Postgres, events only go to the outbox.
   * worker: no controllers; events are dispatched from the outbox to handlers in this process.
   */
  role?: "api" | "worker";
  /** Pre-built adapters, mainly for tests and the simulator. Anything omitted is created from config. */
  overrides?: Partial<{
    tenants: TenantRepository;
    conversations: ConversationRepository;
    sessions: SessionStore;
    dedupe: DedupeStore;
    sender: MessageSender;
    actions: ActionRegistry;
    blueprints: BlueprintRegistry;
    catalog: CatalogRepository;
    orders: OrderRepository;
    eventBus: EventBus;
    users: UserRepository;
    outbox: OutboxStore;
    templates: TemplateRepository;
    templateApi: TemplateApi;
    resources: ResourceRepository;
    assistant: Assistant;
  }>;
}

/** Dashboard owner for the seed tenant when SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are set. */
function seedUsersFromConfig(config: AppConfig, tenantId: string): InMemoryUserRepository {
  if (!config.SEED_ADMIN_EMAIL || !config.SEED_ADMIN_PASSWORD) return new InMemoryUserRepository();
  return new InMemoryUserRepository([
    { tenantId, email: config.SEED_ADMIN_EMAIL, name: config.SEED_ADMIN_NAME, role: "owner", passwordHash: hashPassword(config.SEED_ADMIN_PASSWORD) },
  ]);
}

/** Tenant used when running on in-memory storage, built from SEED_* settings. */
export function seedTenantFromConfig(config: AppConfig): TenantContext {
  return {
    tenant: {
      id: "tenant_seed",
      name: config.SEED_TENANT_NAME,
      slug: "seed",
      blueprintId: config.SEED_BLUEPRINT_ID,
      defaultLanguage: "en",
      timezone: "Asia/Dubai",
      settings: {},
    },
    channel: {
      id: "channel_seed",
      tenantId: "tenant_seed",
      provider: "meta_cloud",
      phoneNumberId: config.SEED_PHONE_NUMBER_ID,
      wabaId: config.SEED_WABA_ID,
      displayPhone: config.SEED_DISPLAY_PHONE,
      accessToken: config.SEED_ACCESS_TOKEN,
      status: "active",
    },
  };
}

@Module({})
export class AppModule {
  static register({ config, role = "api", overrides = {} }: AppOptions): DynamicModule {
    const logger = new Logger("AppModule");
    // The transport talks to Meta (or logs); the sender in front of it keeps demo customers from the simulator page off the wire.
    const transport: MessageSender = overrides.sender ?? (config.WHATSAPP_SENDER === "log" ? new LoggingSender() : new CloudApiClient({ graphVersion: config.META_GRAPH_VERSION }));
    const sender: MessageSender = overrides.sender ?? new DemoAwareSender(transport);
    const providers: Provider[] = [
      { provide: TOKENS.Config, useValue: config },
      { provide: TOKENS.BlueprintRegistry, useValue: overrides.blueprints ?? { get: getBlueprint } },
      OrderService,
      SchedulingService,
      OutboxRelay,
      overrides.actions
        ? { provide: TOKENS.ActionRegistry, useValue: overrides.actions }
        : {
            provide: TOKENS.ActionRegistry,
            useFactory: (catalog: CatalogRepository, orders: OrderService, scheduling: SchedulingService) => createActionRegistry({ catalog, orders, scheduling }),
            inject: [TOKENS.CatalogRepository, OrderService, SchedulingService],
          },
      { provide: TOKENS.MessageSender, useValue: sender },
      InboundQueue,
      ConversationService,
      AuthService,
      AuthGuard,
      MerchantOrdersService,
      TemplateService,
      InboxService,
      SimulatorService,
      AssistantService,
      {
        provide: TOKENS.Assistant,
        useFactory: (): Assistant => {
          if (overrides.assistant) return overrides.assistant;
          if (!config.ANTHROPIC_API_KEY) {
            logger.log("ANTHROPIC_API_KEY not set: AI assistant off, flows run deterministically");
            return new NoopAssistant();
          }
          logger.log(`AI assistant on (${config.ANTHROPIC_MODEL})`);
          return new AnthropicAssistant({ apiKey: config.ANTHROPIC_API_KEY, model: config.ANTHROPIC_MODEL });
        },
      },
      OrderNotifier,
      {
        provide: TOKENS.TemplateApi,
        useFactory: () =>
          overrides.templateApi ?? (config.WHATSAPP_SENDER === "meta" && transport instanceof CloudApiClient ? transport : new FakeTemplateApi()),
      },
    ];

    if (config.storage === "memory") {
      logger.log("storage=memory: tenants, catalog, orders, conversations, sessions and dedupe live in process; events are handled in process");
      const seed = seedTenantFromConfig(config);
      const demo = config.SEED_BLUEPRINT_ID === "salon" ? demoSalonCatalog(seed.tenant.id) : { ...demoCatalog(seed.tenant.id), resources: [] };
      providers.push(
        { provide: TOKENS.ResourceRepository, useValue: overrides.resources ?? new InMemoryResourceRepository(demo.resources) },
        { provide: TOKENS.EventBus, useValue: overrides.eventBus ?? new InMemoryEventBus() },
        { provide: TOKENS.OutboxStore, useValue: overrides.outbox ?? new InMemoryOutboxStore() },
        { provide: TOKENS.TemplateRepository, useValue: overrides.templates ?? new InMemoryTemplateRepository() },
        { provide: TOKENS.CatalogRepository, useValue: overrides.catalog ?? new InMemoryCatalogRepository(demo.categories, demo.offerings) },
        { provide: TOKENS.OrderRepository, useValue: overrides.orders ?? new InMemoryOrderRepository() },
        { provide: TOKENS.TenantRepository, useValue: overrides.tenants ?? new InMemoryTenantRepository([seed]) },
        { provide: TOKENS.ConversationRepository, useValue: overrides.conversations ?? new InMemoryConversationRepository() },
        { provide: TOKENS.SessionStore, useValue: overrides.sessions ?? new InMemorySessionStore() },
        { provide: TOKENS.DedupeStore, useValue: overrides.dedupe ?? new InMemoryDedupeStore() },
        { provide: TOKENS.UserRepository, useValue: overrides.users ?? seedUsersFromConfig(config, seed.tenant.id) },
      );
    } else {
      providers.push(PrismaService);
      if (overrides.eventBus) {
        providers.push({ provide: TOKENS.EventBus, useValue: overrides.eventBus });
      } else if (role === "worker") {
        logger.log("role=worker: dispatching outbox events to handlers in this process");
        providers.push({ provide: TOKENS.EventBus, useValue: new InMemoryEventBus() });
      } else {
        logger.log("role=api: events are written to the outbox for the worker");
        providers.push({ provide: TOKENS.EventBus, useFactory: (p: PrismaService) => new OutboxEventBus(p), inject: [PrismaService] });
      }
      providers.push(
        overrides.outbox
          ? { provide: TOKENS.OutboxStore, useValue: overrides.outbox }
          : { provide: TOKENS.OutboxStore, useFactory: (p: PrismaService) => new PrismaOutboxStore(p), inject: [PrismaService] },
        overrides.templates
          ? { provide: TOKENS.TemplateRepository, useValue: overrides.templates }
          : { provide: TOKENS.TemplateRepository, useFactory: (p: PrismaService) => new PrismaTemplateRepository(p), inject: [PrismaService] },
        overrides.users
          ? { provide: TOKENS.UserRepository, useValue: overrides.users }
          : { provide: TOKENS.UserRepository, useFactory: (p: PrismaService) => new PrismaUserRepository(p), inject: [PrismaService] },
        overrides.catalog
          ? { provide: TOKENS.CatalogRepository, useValue: overrides.catalog }
          : { provide: TOKENS.CatalogRepository, useFactory: (p: PrismaService) => new PrismaCatalogRepository(p), inject: [PrismaService] },
        overrides.orders
          ? { provide: TOKENS.OrderRepository, useValue: overrides.orders }
          : { provide: TOKENS.OrderRepository, useFactory: (p: PrismaService) => new PrismaOrderRepository(p), inject: [PrismaService] },
        overrides.resources
          ? { provide: TOKENS.ResourceRepository, useValue: overrides.resources }
          : { provide: TOKENS.ResourceRepository, useFactory: (p: PrismaService) => new PrismaResourceRepository(p), inject: [PrismaService] },
        overrides.tenants
          ? { provide: TOKENS.TenantRepository, useValue: overrides.tenants }
          : { provide: TOKENS.TenantRepository, useFactory: (p: PrismaService) => new PrismaTenantRepository(p), inject: [PrismaService] },
        overrides.conversations
          ? { provide: TOKENS.ConversationRepository, useValue: overrides.conversations }
          : { provide: TOKENS.ConversationRepository, useFactory: (p: PrismaService) => new PrismaConversationRepository(p), inject: [PrismaService] },
      );
      if (config.REDIS_URL) {
        logger.log("storage=prisma with Redis for sessions and dedupe");
        const redis = createRedis(config.REDIS_URL);
        providers.push(
          { provide: TOKENS.SessionStore, useValue: overrides.sessions ?? new RedisSessionStore(redis) },
          { provide: TOKENS.DedupeStore, useValue: overrides.dedupe ?? new RedisDedupeStore(redis) },
        );
      } else {
        logger.log("storage=prisma without Redis: sessions and dedupe in Postgres");
        providers.push(
          overrides.sessions
            ? { provide: TOKENS.SessionStore, useValue: overrides.sessions }
            : { provide: TOKENS.SessionStore, useFactory: (p: PrismaService) => new PrismaSessionStore(p), inject: [PrismaService] },
          overrides.dedupe
            ? { provide: TOKENS.DedupeStore, useValue: overrides.dedupe }
            : { provide: TOKENS.DedupeStore, useFactory: (p: PrismaService) => new PrismaDedupeStore(p), inject: [PrismaService] },
        );
      }
    }

    return {
      module: AppModule,
      controllers:
        role === "api"
          ? [
              RootController,
              HealthController,
              WebhookController,
              AuthController,
              MerchantOrdersController,
              MerchantTemplatesController,
              MerchantConversationsController,
              MerchantSimulatorController,
              MerchantCatalogController,
              MerchantUsersController,
            ]
          : [],
      providers,
      exports: [ConversationService, InboundQueue, OrderService],
    };
  }
}
