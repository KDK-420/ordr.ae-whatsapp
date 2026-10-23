import { type DynamicModule, Logger, Module, type Provider } from "@nestjs/common";
import { getBlueprint } from "@ordr/blueprints";
import type { ActionRegistry } from "@ordr/flow-schema";
import { CloudApiClient, LoggingSender, type MessageSender } from "@ordr/whatsapp";
import { demoDataFor } from "./actions/demo";
import { createActionRegistry } from "./actions";
import { AdminController } from "./admin/admin.controller";
import { AdminService } from "./admin/admin.service";
import { type ConversationAgent, NoopAgent } from "./ai/agent";
import { AnthropicAgent } from "./ai/anthropic.agent";
import { AnthropicAssistant } from "./ai/anthropic.assistant";
import { type Assistant, NoopAssistant } from "./ai/assistant";
import { AssistantService } from "./ai/assistant.service";
import { createTranscriber, type Transcriber } from "./ai/transcriber";
import { InMemoryConversationRepository, InMemoryDedupeStore, InMemoryNumberPoolRepository, InMemorySessionStore, InMemoryTenantRepository, InMemoryUserRepository } from "./adapters/memory";
import { InMemoryCatalogRepository, InMemoryEventBus, InMemoryOrderRepository, InMemoryOutboxStore, InMemoryResourceRepository } from "./adapters/memory-catalog";
import {
  InMemoryAgentRunRepository,
  InMemoryBookingHoldRepository,
  InMemoryCartRepository,
  InMemoryMemoryRepository,
  InMemoryPaymentIntentRepository,
  InMemoryWebhookReceiptRepository,
  InMemoryWebSessionRepository,
} from "./adapters/memory-commerce";
import {
  PrismaAgentRunRepository,
  PrismaBookingHoldRepository,
  PrismaCartRepository,
  PrismaMemoryRepository,
  PrismaPaymentIntentRepository,
  PrismaWebhookReceiptRepository,
  PrismaWebSessionRepository,
} from "./adapters/prisma-commerce";
import { CommerceService } from "./commerce/commerce.service";
import { MaintenanceService } from "./maintenance.service";
import { MemoryService } from "./memory/memory.service";
import { MockPaymentProvider, type PaymentProvider } from "./payments/payment-provider";
import { PaymentsController } from "./payments/payments.controller";
import { WebChatController } from "./webchat/webchat.controller";
import { WebChatService } from "./webchat/webchat.service";
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
  PrismaNumberPoolRepository,
} from "./adapters/prisma";
import { createRedis, RedisDedupeStore, RedisSessionStore } from "./adapters/redis";
import { AuthController } from "./auth/auth.controller";
import { AuthGuard } from "./auth/auth.guard";
import { AuthService } from "./auth/auth.service";
import { hashPassword } from "./auth/password";
import type { AppConfig } from "./config";
import { ConversationService } from "./conversation/conversation.service";
import { HandoffNotifier } from "./conversation/handoff-notifier";
import { InboundMediaService } from "./conversation/inbound-media.service";
import { InboundQueue } from "./conversation/inbound-queue";
import { OutboxRelay } from "./events/outbox-relay";
import { HealthController } from "./health.controller";
import { InboxService } from "./inbox/inbox.service";
import { MerchantBookingsController } from "./merchant/bookings.controller";
import { MerchantCatalogController } from "./merchant/catalog.controller";
import { MerchantResourcesController } from "./merchant/resources.controller";
import { MerchantSettingsController } from "./merchant/settings.controller";
import { MerchantConversationsController } from "./merchant/conversations.controller";
import { MerchantUsersController } from "./merchant/users.controller";
import { MerchantOrdersService } from "./merchant/merchant-orders.service";
import { MerchantOrdersController } from "./merchant/orders.controller";
import { MerchantTemplatesController } from "./merchant/templates.controller";
import { BookingReminderNotifier } from "./orders/booking-reminder";
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
  NumberPoolRepository,
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
    agent: ConversationAgent;
    transcriber: Transcriber;
    numbers: NumberPoolRepository;
    paymentProvider: PaymentProvider;
  }>;
}

/** Dashboard owner for the seed tenant when SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are set. */
function seedUsersFromConfig(config: AppConfig, tenantId: string): InMemoryUserRepository {
  if (!config.SEED_ADMIN_EMAIL || !config.SEED_ADMIN_PASSWORD) return new InMemoryUserRepository();
  return new InMemoryUserRepository([
    { tenantId, email: config.SEED_ADMIN_EMAIL, name: config.SEED_ADMIN_NAME, role: "owner", isPlatformAdmin: true, passwordHash: hashPassword(config.SEED_ADMIN_PASSWORD) },
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
      CommerceService,
      MemoryService,
      WebChatService,
      MaintenanceService,
      OutboxRelay,
      {
        provide: TOKENS.PaymentProvider,
        useFactory: (): PaymentProvider => {
          if (overrides.paymentProvider) return overrides.paymentProvider;
          const secret = config.PAYMENT_WEBHOOK_SECRET ?? config.AUTH_SECRET ?? config.META_APP_SECRET;
          logger.log(`payments: ${config.PAYMENT_PROVIDER} provider, checkout pages at ${config.PUBLIC_BASE_URL}/pay/<intent>`);
          return new MockPaymentProvider(secret, config.PUBLIC_BASE_URL);
        },
      },
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
      AdminService,
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
      {
        provide: TOKENS.Agent,
        useFactory: (scheduling: SchedulingService, commerce: CommerceService, memory: MemoryService): ConversationAgent => {
          if (overrides.agent) return overrides.agent;
          if (!config.ANTHROPIC_API_KEY) return new NoopAgent();
          return new AnthropicAgent({ scheduling, commerce, memory }, { apiKey: config.ANTHROPIC_API_KEY, model: config.ANTHROPIC_MODEL });
        },
        inject: [SchedulingService, CommerceService, MemoryService],
      },
      {
        provide: TOKENS.Transcriber,
        useFactory: (): Transcriber => {
          if (overrides.transcriber) return overrides.transcriber;
          const transcriber = createTranscriber(config);
          if (!transcriber.enabled) logger.log("TRANSCRIPTION_PROVIDER=none: voice notes are described to the agent, not transcribed");
          else logger.log(`voice notes transcribed with ${config.TRANSCRIPTION_PROVIDER} (${config.TRANSCRIPTION_MODEL})`);
          return transcriber;
        },
      },
      InboundMediaService,
      OrderNotifier,
      BookingReminderNotifier,
      HandoffNotifier,
      {
        provide: TOKENS.TemplateApi,
        useFactory: () =>
          overrides.templateApi ?? (config.WHATSAPP_SENDER === "meta" && transport instanceof CloudApiClient ? transport : new FakeTemplateApi()),
      },
    ];

    if (config.storage === "memory") {
      logger.log("storage=memory: tenants, catalog, orders, conversations, sessions and dedupe live in process; events are handled in process");
      const seed = seedTenantFromConfig(config);
      const demo = demoDataFor(config.SEED_BLUEPRINT_ID, seed.tenant.id);
      const orders = overrides.orders ?? new InMemoryOrderRepository();
      const holds = new InMemoryBookingHoldRepository(orders);
      if (orders instanceof InMemoryOrderRepository) orders.holds = holds;
      providers.push(
        { provide: TOKENS.BookingHoldRepository, useValue: holds },
        { provide: TOKENS.CartRepository, useValue: new InMemoryCartRepository() },
        { provide: TOKENS.PaymentIntentRepository, useValue: new InMemoryPaymentIntentRepository() },
        { provide: TOKENS.WebhookReceiptRepository, useValue: new InMemoryWebhookReceiptRepository() },
        { provide: TOKENS.WebSessionRepository, useValue: new InMemoryWebSessionRepository() },
        { provide: TOKENS.MemoryRepository, useValue: new InMemoryMemoryRepository() },
        { provide: TOKENS.AgentRunRepository, useValue: new InMemoryAgentRunRepository() },
        { provide: TOKENS.ResourceRepository, useValue: overrides.resources ?? new InMemoryResourceRepository(demo.resources) },
        { provide: TOKENS.EventBus, useValue: overrides.eventBus ?? new InMemoryEventBus() },
        { provide: TOKENS.OutboxStore, useValue: overrides.outbox ?? new InMemoryOutboxStore() },
        { provide: TOKENS.TemplateRepository, useValue: overrides.templates ?? new InMemoryTemplateRepository() },
        { provide: TOKENS.CatalogRepository, useValue: overrides.catalog ?? new InMemoryCatalogRepository(demo.categories, demo.offerings) },
        { provide: TOKENS.OrderRepository, useValue: orders },
        { provide: TOKENS.TenantRepository, useValue: overrides.tenants ?? new InMemoryTenantRepository([seed]) },
        { provide: TOKENS.ConversationRepository, useValue: overrides.conversations ?? new InMemoryConversationRepository() },
        { provide: TOKENS.SessionStore, useValue: overrides.sessions ?? new InMemorySessionStore() },
        { provide: TOKENS.DedupeStore, useValue: overrides.dedupe ?? new InMemoryDedupeStore() },
        { provide: TOKENS.UserRepository, useValue: overrides.users ?? seedUsersFromConfig(config, seed.tenant.id) },
        { provide: TOKENS.NumberPoolRepository, useValue: overrides.numbers ?? new InMemoryNumberPoolRepository() },
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
        overrides.numbers
          ? { provide: TOKENS.NumberPoolRepository, useValue: overrides.numbers }
          : { provide: TOKENS.NumberPoolRepository, useFactory: (p: PrismaService) => new PrismaNumberPoolRepository(p), inject: [PrismaService] },
        { provide: TOKENS.BookingHoldRepository, useFactory: (p: PrismaService) => new PrismaBookingHoldRepository(p), inject: [PrismaService] },
        { provide: TOKENS.CartRepository, useFactory: (p: PrismaService) => new PrismaCartRepository(p), inject: [PrismaService] },
        { provide: TOKENS.PaymentIntentRepository, useFactory: (p: PrismaService) => new PrismaPaymentIntentRepository(p), inject: [PrismaService] },
        { provide: TOKENS.WebhookReceiptRepository, useFactory: (p: PrismaService) => new PrismaWebhookReceiptRepository(p), inject: [PrismaService] },
        { provide: TOKENS.WebSessionRepository, useFactory: (p: PrismaService) => new PrismaWebSessionRepository(p), inject: [PrismaService] },
        { provide: TOKENS.MemoryRepository, useFactory: (p: PrismaService) => new PrismaMemoryRepository(p), inject: [PrismaService] },
        { provide: TOKENS.AgentRunRepository, useFactory: (p: PrismaService) => new PrismaAgentRunRepository(p), inject: [PrismaService] },
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
              AdminController,
              MerchantBookingsController,
              MerchantResourcesController,
              MerchantSettingsController,
              MerchantCatalogController,
              MerchantUsersController,
              WebChatController,
              PaymentsController,
            ]
          : [],
      providers,
      exports: [ConversationService, InboundQueue, OrderService, MaintenanceService],
    };
  }
}
