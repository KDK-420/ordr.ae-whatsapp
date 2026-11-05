import { type BlueprintInput, parseBlueprint } from "@ordr/flow-schema";
import language from "../restaurant/flows/language.json";
import talkToUs from "../restaurant/flows/talk_to_us.json";
import myBookings from "../salon/flows/my_bookings.json";
import photos from "../salon/flows/photos.json";
import blueprint from "./blueprint.json";
import bookCourt from "./flows/book_court.json";
import mainMenu from "./flows/main_menu.json";

/** Courts are resources of type "asset"; each sport and duration is an offering, so the salon's booking engine serves them unchanged. */
export const sports = parseBlueprint({
  ...(blueprint as Omit<BlueprintInput, "flows">),
  flows: [mainMenu, bookCourt, myBookings, photos, talkToUs, language],
} as BlueprintInput);
