import type { Blueprint } from "@ordr/flow-schema";
import { resort } from "./resort";
import { restaurant } from "./restaurant";
import { retail } from "./retail";
import { salon } from "./salon";

export { resort, restaurant, retail, salon };

export const blueprints: Record<string, Blueprint> = {
  [restaurant.id]: restaurant,
  [salon.id]: salon,
  [retail.id]: retail,
  [resort.id]: resort,
};

export function getBlueprint(id: string): Blueprint | undefined {
  return blueprints[id];
}
