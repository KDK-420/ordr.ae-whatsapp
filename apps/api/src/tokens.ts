/** Injection tokens. Every constructor uses explicit @Inject so no decorator metadata is needed. */
export const TOKENS = {
  Config: Symbol("Config"),
  TenantRepository: Symbol("TenantRepository"),
  ConversationRepository: Symbol("ConversationRepository"),
  SessionStore: Symbol("SessionStore"),
  DedupeStore: Symbol("DedupeStore"),
  MessageSender: Symbol("MessageSender"),
  ActionRegistry: Symbol("ActionRegistry"),
  BlueprintRegistry: Symbol("BlueprintRegistry"),
  CatalogRepository: Symbol("CatalogRepository"),
  OrderRepository: Symbol("OrderRepository"),
  EventBus: Symbol("EventBus"),
  UserRepository: Symbol("UserRepository"),
  OutboxStore: Symbol("OutboxStore"),
  TemplateRepository: Symbol("TemplateRepository"),
  TemplateApi: Symbol("TemplateApi"),
} as const;
