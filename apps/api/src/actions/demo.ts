import type { Category, Offering, Property, Resource } from "@ordr/domain";
import { demoCatalog } from "./demo-catalog";
import { demoResortCatalog } from "./demo-resort";
import { demoRetailCatalog } from "./demo-retail";
import { demoSalonCatalog } from "./demo-salon";

export interface DemoData {
  categories: Category[];
  offerings: Offering[];
  resources: Resource[];
  /** Resorts for the resort vertical; empty elsewhere. */
  properties: Property[];
}

/** The demo data that fits a vertical: salon services and staff, retail products with stock, four resorts with room types, else the restaurant menu. */
export function demoDataFor(blueprintId: string, tenantId: string): DemoData {
  if (blueprintId === "salon") return { ...demoSalonCatalog(tenantId), properties: [] };
  if (blueprintId === "retail") return { ...demoRetailCatalog(tenantId), properties: [] };
  if (blueprintId === "resort") return demoResortCatalog(tenantId);
  return { ...demoCatalog(tenantId), resources: [], properties: [] };
}
