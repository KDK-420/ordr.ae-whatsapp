import { type DynamicModule, Logger, Module, type Provider } from "@nestjs/common";
import { getBlueprint } from "@ordr/blueprints";
import type { ActionRegistry } from "@ordr/flow-schema";
import { CloudApiClient, LoggingSender, type MessageSender } from "@ordr/whatsapp";
import { demoCatalog } from "./actions/demo-catalog";
import { createActionRegistry } from "./actions";
import { InMemoryConversationRepository, InMemoryDedupeStore, InMemorySessionStore, InMemoryTenantRepository, InMemoryUserRepository } from "./adapters/memory";
import { InMemoryCatalogRepository, InMemoryEventBus, InMemoryOrderRepository } from "./adapters/memory-catalog";
import { PrismaCatalogRepository, PrismaOrderRepository } from "./adapters/prisma-catalog";
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
import { HealthController } from "./health.controller";
import { MerchantOrdersService } from "./merchant/merchant-orders.service";
import { MerchantOrdersController } from "./merchant/orders.controller";
import { OrderNotifier } from "./orders/order-notifier";
import { OrderService } from "./orders/order.service";
import type {
  BlueprintRegistry,
  CatalogRepository,
  ConversationRepository,
  DedupeStore,
  EventBus,
  OrderRepository,
  SessionStore,
  TenantContext,
  TenantRepository,
  UserRepository,
} from "./ports";
import { RootController } from "./root.controller";
import { TOKENS } from "./tokens";
import { WebhookController } from "./webhook/webhook.controller";

export interface AppOptions {
  config: AppConfig;
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
  static register({ config, overrides = {} }: AppOptions): DynamicModule {
    const logger = new Logger("AppModule");
    const providers: Provider[] = [
      { provide: TOKENS.Config, useValue: config },
      { provide: TOKENS.BlueprintRegistry, useValue: overrides.blueprints ?? { get: getBlueprint } },
      { provide: TOKENS.EventBus, useValue: overrides.eventBus ?? new InMemoryEventBus() },
      OrderService,
      overrides.actions
        ? { provide: TOKENS.ActionRegistry, useValue: overrides.actions }
        : {
            provide: TOKENS.ActionRegistry,
            useFactory: (catalog: CatalogRepository, orders: OrderService) => createActionRegistry({ catalog, orders }),
            inject: [TOKENS.CatalogRepository, OrderService],
          },
      {
        provide: TOKENS.MessageSender,
        useValue:
          overrides.sender ??
          (config.WHATSAPP_SENDER === "log" ? new LoggingSender() : new CloudApiClient({ graphVersion: config.META_GRAPH_VERSION })),
      },
      InboundQueue,
      ConversationService,
      AuthService,
      AuthGuard,
      MerchantOrdersService,
      OrderNotifier,
    ];

    if (config.storage === "memory") {
      logger.log("storage=memory: tenants, catalog, orders, conversations, sessions and dedupe live in process");
      const seed = seedTenantFromConfig(config);
      const demo = demoCatalog(seed.tenant.id);
      providers.push(
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
      providers.push(
        overrides.users
          ? { provide: TOKENS.UserRepository, useValue: overrides.users }
          : { provide: TOKENS.UserRepository, useFactory: (p: PrismaService) => new PrismaUserRepository(p), inject: [PrismaService] },
        overrides.catalog
          ? { provide: TOKENS.CatalogRepository, useValue: overrides.catalog }
          : { provide: TOKENS.CatalogRepository, useFactory: (p: PrismaService) => new PrismaCatalogRepository(p), inject: [PrismaService] },
        overrides.orders
          ? { provide: TOKENS.OrderRepository, useValue: overrides.orders }
          : { provide: TOKENS.OrderRepository, useFactory: (p: PrismaService) => new PrismaOrderRepository(p), inject: [PrismaService] },
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
      controllers: [RootController, HealthController, WebhookController, AuthController, MerchantOrdersController],
      providers,
      exports: [ConversationService, InboundQueue, OrderService],
    };
  }
}
