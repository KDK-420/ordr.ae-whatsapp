import type { Category, Offering, Property, Resource } from "@ordr/domain";
import { type CoffeeDemo, demoCoffee } from "./demo-coffee";
import { demoCatalog } from "./demo-catalog";
import { demoResortCatalog } from "./demo-resort";
import { demoRetailCatalog } from "./demo-retail";
import { demoSalonCatalog } from "./demo-salon";
import { demoSportsCatalog } from "./demo-sports";

export interface DemoData {
  categories: Category[];
  offerings: Offering[];
  resources: Resource[];
  /** Resorts for the resort vertical; empty elsewhere. */
  properties: Property[];
  /** Restaurant suite demo (branch, stations, stock, recipes, settings); only with the coffee set. */
  suite?: CoffeeDemo;
}

/** Demo sets a restaurant can be seeded with besides the default menu. */
export const DEMO_SETS = ["coffee"] as const;
export type DemoSet = (typeof DEMO_SETS)[number];

/** The demo data that fits a vertical: salon services and staff, retail products with stock, four resorts with room types, sports courts, else the restaurant menu. */
export function demoDataFor(blueprintId: string, tenantId: string, set?: DemoSet): DemoData {
  if (blueprintId === "restaurant" && set === "coffee") {
    const coffee = demoCoffee(tenantId);
    return { categories: coffee.categories, offerings: coffee.offerings, resources: [], properties: [], suite: coffee };
  }
  if (blueprintId === "salon") return { ...demoSalonCatalog(tenantId), properties: [] };
  if (blueprintId === "retail") return { ...demoRetailCatalog(tenantId), properties: [] };
  if (blueprintId === "resort") return demoResortCatalog(tenantId);
  if (blueprintId === "sports") return { ...demoSportsCatalog(tenantId), properties: [] };
  return { ...demoCatalog(tenantId), resources: [], properties: [] };
}
