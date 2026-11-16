import type { Category, Offering } from "@ordr/domain";
import type { Branch, RecipeLine, StockItem, Supplier } from "../suite/types";

export interface CoffeeDemo {
  categories: Category[];
  offerings: Offering[];
  branches: Branch[];
  stockItems: StockItem[];
  recipeLines: RecipeLine[];
  suppliers: Supplier[];
  /** Opening stock per item, in stock units. */
  opening: Array<{ stockItemId: string; units: number }>;
  /** Tenant settings that make the demo a complete coffee shop: modules, theme, prices before VAT. */
  settings: Record<string, unknown>;
}

/**
 * Demo coffee shop for the restaurant suite ("Daybreak Coffee" in the mockups): a menu with
 * sizes and extras, one branch with a bar and a bakery station, and stock with recipes that
 * deduct beans, milk and the right cup. Ids are stable so tests can reference them. Photos are
 * illustrations shipped with the dashboard (`/art/coffee/*.svg`).
 */
export function demoCoffee(tenantId: string): CoffeeDemo {
  const img = (name: string) => `/art/coffee/${name}.svg`;
  const categories: Category[] = [
    { id: "cat_coffee", tenantId, name: { en: "Coffee", ar: "قهوة" }, sortOrder: 1, isActive: true },
    { id: "cat_cold", tenantId, name: { en: "Cold Drinks", ar: "مشروبات باردة" }, sortOrder: 2, isActive: true },
    { id: "cat_bakery", tenantId, name: { en: "Bakery", ar: "مخبوزات" }, sortOrder: 3, isActive: true },
    { id: "cat_desserts", tenantId, name: { en: "Desserts", ar: "حلويات" }, sortOrder: 4, isActive: true },
  ];

  const size = (p: string) => ({
    id: `${p}_size`,
    name: { en: "Size", ar: "الحجم" },
    minSelect: 1,
    maxSelect: 1,
    sortOrder: 1,
    options: [
      { id: `${p}_size_regular`, name: { en: "Regular", ar: "عادي" }, priceDeltaMinor: 0, sortOrder: 1, isActive: true },
      { id: `${p}_size_large`, name: { en: "Large", ar: "كبير" }, priceDeltaMinor: 400, sortOrder: 2, isActive: true },
    ],
  });
  const milk = (p: string) => ({
    id: `${p}_milk`,
    name: { en: "Milk", ar: "الحليب" },
    minSelect: 0,
    maxSelect: 1,
    sortOrder: 2,
    options: [
      { id: `${p}_milk_oat`, name: { en: "Oat milk", ar: "حليب الشوفان" }, priceDeltaMinor: 300, sortOrder: 1, isActive: true },
      { id: `${p}_milk_skim`, name: { en: "Skimmed milk", ar: "حليب خالي الدسم" }, priceDeltaMinor: 0, sortOrder: 2, isActive: true },
    ],
  });
  const extras = (p: string) => ({
    id: `${p}_extras`,
    name: { en: "Extras", ar: "إضافات" },
    minSelect: 0,
    maxSelect: 2,
    sortOrder: 3,
    options: [
      { id: `${p}_extra_shot`, name: { en: "Extra shot", ar: "جرعة إضافية" }, priceDeltaMinor: 400, sortOrder: 1, isActive: true },
      { id: `${p}_extra_caramel`, name: { en: "Caramel syrup", ar: "شراب الكراميل" }, priceDeltaMinor: 200, sortOrder: 2, isActive: true },
    ],
  });

  const item = (id: string, categoryId: string, en: string, ar: string, priceMinor: number, sortOrder: number, image: string, description: [string, string], groups: Offering["modifierGroups"] = []): Offering => ({
    id,
    tenantId,
    categoryId,
    type: "product",
    name: { en, ar },
    description: { en: description[0], ar: description[1] },
    priceMinor,
    currency: "AED",
    imageUrl: img(image),
    sortOrder,
    isActive: true,
    modifierGroups: groups,
  });

  const offerings: Offering[] = [
    item("cof_espresso", "cat_coffee", "Espresso", "إسبريسو", 1200, 1, "espresso", ["A double shot of our house blend.", "جرعة مزدوجة من خلطتنا الخاصة."], [extras("esp")]),
    item("cof_americano", "cat_coffee", "Americano", "أمريكانو", 1400, 2, "americano", ["Espresso and hot water, clean and bold.", "إسبريسو مع ماء ساخن، نقي وقوي."], [size("ame"), extras("ame")]),
    item("cof_cappuccino", "cat_coffee", "Cappuccino", "كابتشينو", 1800, 3, "cappuccino", ["Espresso under thick, velvety foam.", "إسبريسو تحت رغوة كثيفة ناعمة."], [size("cap"), milk("cap"), extras("cap")]),
    item("cof_latte", "cat_coffee", "Latte", "لاتيه", 1800, 4, "latte", ["Espresso with steamed milk and latte art.", "إسبريسو مع حليب مبخر وفن اللاتيه."], [size("lat"), milk("lat"), extras("lat")]),
    item("cof_mocha", "cat_coffee", "Mocha", "موكا", 2000, 5, "mocha", ["Espresso, chocolate and steamed milk.", "إسبريسو وشوكولاتة وحليب مبخر."], [size("moc"), milk("moc")]),
    item("cof_macchiato", "cat_coffee", "Caramel Macchiato", "كراميل ماكياتو", 2200, 6, "macchiato", ["Vanilla, milk, espresso and a caramel drizzle.", "فانيلا وحليب وإسبريسو مع الكراميل."], [size("mac"), milk("mac")]),
    item("cold_iced_americano", "cat_cold", "Iced Americano", "أمريكانو مثلج", 1600, 7, "iced-americano", ["Espresso over ice and cold water.", "إسبريسو على الثلج والماء البارد."], [extras("iam")]),
    item("cold_iced_latte", "cat_cold", "Iced Latte", "لاتيه مثلج", 1800, 8, "iced-latte", ["Espresso and cold milk over ice.", "إسبريسو وحليب بارد على الثلج."], [milk("ila"), extras("ila")]),
    item("cold_cold_brew", "cat_cold", "Cold Brew", "كولد برو", 1800, 9, "cold-brew", ["Steeped for 18 hours, smooth and sweet.", "منقوعة 18 ساعة، ناعمة وحلوة."]),
    item("bak_croissant", "cat_bakery", "Butter Croissant", "كرواسون بالزبدة", 1400, 10, "croissant", ["Baked every morning, flaky and golden.", "يُخبز كل صباح، هش وذهبي."]),
    item("bak_muffin", "cat_bakery", "Blueberry Muffin", "مافن التوت الأزرق", 1400, 11, "muffin", ["Bursting with blueberries.", "مليء بالتوت الأزرق."]),
    item("bak_brownie", "cat_bakery", "Brownie", "براوني", 1500, 12, "brownie", ["Dense, fudgy dark chocolate.", "شوكولاتة داكنة كثيفة."]),
    item("des_chocolate_cake", "cat_desserts", "Chocolate Cake", "كيكة الشوكولاتة", 2400, 13, "chocolate-cake", ["Three layers with ganache.", "ثلاث طبقات مع الغاناش."]),
    item("des_cheesecake", "cat_desserts", "Cheesecake", "تشيز كيك", 2200, 14, "cheesecake", ["Baked New York style.", "مخبوزة على طريقة نيويورك."]),
  ];

  const branches: Branch[] = [
    {
      id: "br_main",
      tenantId,
      name: "Main Store",
      address: "Boulevard Plaza, Downtown Dubai",
      phone: "+971 4 000 1234",
      stations: [
        { id: "st_bar", name: "Bar", categoryIds: ["cat_coffee", "cat_cold"] },
        { id: "st_bakery", name: "Bakery", categoryIds: ["cat_bakery", "cat_desserts"] },
      ],
      sortOrder: 0,
      isActive: true,
    },
  ];

  const stock = (id: string, name: string, category: string, kind: StockItem["kind"], baseUnit: StockItem["baseUnit"], unitLabel: string, unitSize: number, reorderLevel: number, costMinor: number): StockItem => ({ id, tenantId, name, category, kind, baseUnit, unitLabel, unitSize, reorderLevel, costMinor, isActive: true });
  const stockItems: StockItem[] = [
    stock("stk_beans", "Arabica Coffee Beans (1kg)", "Coffee", "ingredient", "g", "1kg bag", 1000, 10, 9500),
    stock("stk_milk", "Whole Milk (1L)", "Dairy", "ingredient", "ml", "1L", 1000, 20, 650),
    stock("stk_oat", "Oat Milk (1L)", "Dairy", "ingredient", "ml", "1L", 1000, 20, 1400),
    stock("stk_choc", "Chocolate Syrup (750ml)", "Syrups", "ingredient", "ml", "750ml bottle", 750, 10, 2800),
    stock("stk_caramel", "Caramel Syrup (750ml)", "Syrups", "ingredient", "ml", "750ml bottle", 750, 6, 2800),
    stock("stk_croissant", "Croissant (Frozen)", "Bakery", "resale", "each", "piece", 1, 15, 450),
    stock("stk_muffin", "Blueberry Muffin", "Bakery", "resale", "each", "piece", 1, 10, 500),
    stock("stk_brownie", "Brownie", "Bakery", "resale", "each", "piece", 1, 10, 480),
    stock("stk_cake", "Chocolate Cake (slice)", "Bakery", "resale", "each", "slice", 1, 6, 900),
    stock("stk_cheesecake", "Cheesecake (slice)", "Bakery", "resale", "each", "slice", 1, 6, 850),
    stock("stk_cup_s", "Hot Cup 8oz", "Packaging", "packaging", "each", "sleeve of 50", 50, 6, 1800),
    stock("stk_cup_m", "Hot Cup 12oz", "Packaging", "packaging", "each", "sleeve of 50", 50, 8, 2200),
    stock("stk_cup_l", "Hot Cup 16oz", "Packaging", "packaging", "each", "sleeve of 50", 50, 8, 2600),
    stock("stk_lid", "Hot Cup Lid", "Packaging", "packaging", "each", "sleeve of 100", 100, 6, 1500),
    stock("stk_cold_cup", "Cold Cup 16oz", "Packaging", "packaging", "each", "sleeve of 50", 50, 6, 2400),
    stock("stk_bag", "Paper Bag", "Packaging", "packaging", "each", "pack of 100", 100, 3, 3000),
  ];

  const recipeLines: RecipeLine[] = [];
  let n = 0;
  const use = (offeringId: string, stockItemId: string, quantity: number, opts: { option?: string; appliesTo?: RecipeLine["appliesTo"] } = {}) => recipeLines.push({ id: `rcp_${++n}`, tenantId, offeringId, stockItemId, quantity, modifierOptionId: opts.option, appliesTo: opts.appliesTo ?? "all" });
  /** A hot drink with sizes: beans always, milk by size, and the right cup and a lid only when it leaves the shop. */
  const hot = (offeringId: string, p: string, beans: number, milkRegular: number, milkLarge: number) => {
    use(offeringId, "stk_beans", beans);
    if (milkRegular) use(offeringId, "stk_milk", milkRegular, { option: `${p}_size_regular` });
    if (milkLarge) use(offeringId, "stk_milk", milkLarge, { option: `${p}_size_large` });
    use(offeringId, "stk_cup_m", 1, { option: `${p}_size_regular`, appliesTo: "takeaway" });
    use(offeringId, "stk_cup_l", 1, { option: `${p}_size_large`, appliesTo: "takeaway" });
    use(offeringId, "stk_lid", 1, { appliesTo: "takeaway" });
  };
  use("cof_espresso", "stk_beans", 18);
  use("cof_espresso", "stk_cup_s", 1, { appliesTo: "takeaway" });
  use("cof_espresso", "stk_lid", 1, { appliesTo: "takeaway" });
  hot("cof_americano", "ame", 18, 0, 0);
  hot("cof_cappuccino", "cap", 18, 150, 220);
  hot("cof_latte", "lat", 18, 220, 320);
  hot("cof_mocha", "moc", 18, 200, 300);
  use("cof_mocha", "stk_choc", 30);
  hot("cof_macchiato", "mac", 18, 200, 300);
  use("cof_macchiato", "stk_caramel", 20);
  for (const p of ["esp", "ame", "cap", "lat", "iam", "ila"]) {
    const offeringId = { esp: "cof_espresso", ame: "cof_americano", cap: "cof_cappuccino", lat: "cof_latte", iam: "cold_iced_americano", ila: "cold_iced_latte" }[p]!;
    use(offeringId, "stk_beans", 9, { option: `${p}_extra_shot` });
    use(offeringId, "stk_caramel", 15, { option: `${p}_extra_caramel` });
  }
  use("cold_iced_americano", "stk_beans", 18);
  use("cold_iced_americano", "stk_cold_cup", 1);
  use("cold_iced_latte", "stk_beans", 18);
  use("cold_iced_latte", "stk_milk", 250);
  use("cold_iced_latte", "stk_cold_cup", 1);
  use("cold_cold_brew", "stk_beans", 25);
  use("cold_cold_brew", "stk_cold_cup", 1);
  use("bak_croissant", "stk_croissant", 1);
  use("bak_muffin", "stk_muffin", 1);
  use("bak_brownie", "stk_brownie", 1);
  use("des_chocolate_cake", "stk_cake", 1);
  use("des_cheesecake", "stk_cheesecake", 1);
  for (const o of ["bak_croissant", "bak_muffin", "bak_brownie"]) use(o, "stk_bag", 1, { appliesTo: "takeaway" });

  const suppliers: Supplier[] = [
    { id: "sup_roastery", tenantId, name: "Emirates Roastery", phone: "+971 4 000 2001", email: "orders@roastery.example", leadDays: 2, isActive: true },
    { id: "sup_dairy", tenantId, name: "Al Marai Distribution", phone: "+971 4 000 2002", leadDays: 1, isActive: true },
    { id: "sup_packaging", tenantId, name: "Gulf Packaging Co.", phone: "+971 4 000 2003", leadDays: 5, isActive: true },
  ];

  // Chosen so the overview shows every state: plenty of beans, milk running low, croissants gone.
  const opening = [
    { stockItemId: "stk_beans", units: 24 },
    { stockItemId: "stk_milk", units: 18 },
    { stockItemId: "stk_oat", units: 6 },
    { stockItemId: "stk_choc", units: 32 },
    { stockItemId: "stk_caramel", units: 12 },
    { stockItemId: "stk_croissant", units: 0 },
    { stockItemId: "stk_muffin", units: 22 },
    { stockItemId: "stk_brownie", units: 18 },
    { stockItemId: "stk_cake", units: 9 },
    { stockItemId: "stk_cheesecake", units: 7 },
    { stockItemId: "stk_cup_s", units: 12 },
    { stockItemId: "stk_cup_m", units: 20 },
    { stockItemId: "stk_cup_l", units: 14 },
    { stockItemId: "stk_lid", units: 16 },
    { stockItemId: "stk_cold_cup", units: 10 },
    { stockItemId: "stk_bag", units: 5 },
  ];

  const settings: Record<string, unknown> = {
    modules: ["storefront", "pos", "kds", "inventory", "whatsapp"],
    theme: { swatch: "espresso", tagline: "Specialty coffee" },
    // The mockups show prices before VAT with the tax added on the ticket.
    vatInclusive: false,
    deliveryFeeMinor: 800,
    site: { published: true, headline: "Exceptional Coffee, Delivered.", about: "Freshly brewed coffee, handcrafted drinks and delicious treats. Order online for pickup or delivery." },
    profile: { address: "Boulevard Plaza, Downtown Dubai", phone: "+971 4 000 1234", hours: "Every day 07:00 to 23:00" },
  };

  return { categories, offerings, branches, stockItems, recipeLines, suppliers, opening, settings };
}
