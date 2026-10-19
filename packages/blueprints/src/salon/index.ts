import { type BlueprintInput, parseBlueprint } from "@ordr/flow-schema";
import language from "../restaurant/flows/language.json";
import talkToUs from "../restaurant/flows/talk_to_us.json";
import blueprint from "./blueprint.json";
import bookService from "./flows/book_service.json";
import mainMenu from "./flows/main_menu.json";
import myBookings from "./flows/my_bookings.json";

export const salon = parseBlueprint({
  ...(blueprint as Omit<BlueprintInput, "flows">),
  flows: [mainMenu, bookService, myBookings, talkToUs, language],
} as BlueprintInput);
