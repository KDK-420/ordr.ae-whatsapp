import type { Blueprint } from "@ordr/flow-schema";
import { resort } from "./resort";
import { restaurant } from "./restaurant";
import { retail } from "./retail";
import { salon } from "./salon";
import { sports } from "./sports";

export { resort, restaurant, retail, salon, sports };

export const blueprints: Record<string, Blueprint> = {
  [restaurant.id]: restaurant,
  [salon.id]: salon,
  [retail.id]: retail,
  [resort.id]: resort,
  [sports.id]: sports,
};

export function getBlueprint(id: string): Blueprint | undefined {
  return blueprints[id];
}
