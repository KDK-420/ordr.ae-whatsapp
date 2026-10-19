import type { Blueprint } from "@ordr/flow-schema";
import { restaurant } from "./restaurant";
import { salon } from "./salon";

export { restaurant, salon };

export const blueprints: Record<string, Blueprint> = {
  [restaurant.id]: restaurant,
  [salon.id]: salon,
};

export function getBlueprint(id: string): Blueprint | undefined {
  return blueprints[id];
}
