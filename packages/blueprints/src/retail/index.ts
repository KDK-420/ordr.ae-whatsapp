import { type BlueprintInput, parseBlueprint } from "@ordr/flow-schema";
import language from "../restaurant/flows/language.json";
import talkToUs from "../restaurant/flows/talk_to_us.json";
import blueprint from "./blueprint.json";
import mainMenu from "./flows/main_menu.json";

/**
 * Retail runs in the natural conversation style: Claude sells through commerce tools. The only
 * guided flows are the fallbacks used when the model is unavailable.
 */
export const retail = parseBlueprint({
  ...(blueprint as Omit<BlueprintInput, "flows">),
  flows: [mainMenu, talkToUs, language],
} as BlueprintInput);
