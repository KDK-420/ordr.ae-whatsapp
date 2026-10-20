import type { Category, Offering, Resource } from "@ordr/domain";
import { demoCatalog } from "./demo-catalog";
import { demoRetailCatalog } from "./demo-retail";
import { demoSalonCatalog } from "./demo-salon";

export interface DemoData {
  categories: Category[];
  offerings: Offering[];
  resources: Resource[];
}

/** The demo data that fits a vertical: salon services and staff, retail products with stock, else the restaurant menu. */
export function demoDataFor(blueprintId: string, tenantId: string): DemoData {
  if (blueprintId === "salon") return demoSalonCatalog(tenantId);
  if (blueprintId === "retail") return demoRetailCatalog(tenantId);
  return { ...demoCatalog(tenantId), resources: [] };
}
