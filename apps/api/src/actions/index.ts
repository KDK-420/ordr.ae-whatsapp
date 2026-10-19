import { MapActionRegistry } from "@ordr/flow-schema";
import type { OrderService } from "../orders/order.service";
import type { CatalogRepository } from "../ports";
import type { SchedulingService } from "../scheduling/scheduling.service";
import { registerBookingActions } from "./booking.actions";
import { registerCartActions } from "./cart.actions";
import { registerCatalogActions } from "./catalog.actions";
import { registerOrderActions } from "./order.actions";

/** Every action a blueprint may call, bound to the tenant-scoped services behind it. */
export function createActionRegistry(deps: { catalog: CatalogRepository; orders: OrderService; scheduling?: SchedulingService }): MapActionRegistry {
  const registry = new MapActionRegistry();
  registerCatalogActions(registry, deps.catalog);
  registerCartActions(registry, deps.catalog);
  registerOrderActions(registry, deps.orders);
  if (deps.scheduling) registerBookingActions(registry, deps.scheduling);
  return registry;
}
