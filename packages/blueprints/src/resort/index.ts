import { type BlueprintInput, parseBlueprint } from "@ordr/flow-schema";
import language from "../restaurant/flows/language.json";
import talkToUs from "../restaurant/flows/talk_to_us.json";
import blueprint from "./blueprint.json";
import mainMenu from "./flows/main_menu.json";
import photos from "./flows/photos.json";

/**
 * Resort group: one tenant (one WhatsApp number, one owner login) runs one or more properties.
 * The conversation is the Claude agent with stay tools; the guided flows only cover the
 * fallback, the photo catalog, talk-to-us and language.
 */
export const resort = parseBlueprint({
  ...(blueprint as Omit<BlueprintInput, "flows">),
  flows: [mainMenu, photos, talkToUs, language],
} as BlueprintInput);
