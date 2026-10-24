import { type BlueprintInput, parseBlueprint } from "@ordr/flow-schema";
import blueprint from "./blueprint.json";
import checkout from "./flows/checkout.json";
import language from "./flows/language.json";
import mainMenu from "./flows/main_menu.json";
import orderFood from "./flows/order_food.json";
import photos from "./flows/photos.json";
import talkToUs from "./flows/talk_to_us.json";
import trackOrder from "./flows/track_order.json";
import viewCart from "./flows/view_cart.json";

export const restaurant = parseBlueprint({
  ...(blueprint as Omit<BlueprintInput, "flows">),
  flows: [mainMenu, orderFood, checkout, viewCart, trackOrder, photos, talkToUs, language],
} as BlueprintInput);
