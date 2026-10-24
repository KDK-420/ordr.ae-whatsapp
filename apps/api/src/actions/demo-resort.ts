import type { Category, Offering, Property, Resource } from "@ordr/domain";

/**
 * Demo resort group: one owner, one WhatsApp number, four properties across the UAE, each with
 * its own room types, inventory and photos. Used by the in-memory store (web chat demo, tests)
 * and by the Prisma seed and the admin console when SEED_BLUEPRINT_ID / vertical is "resort".
 * Ids are stable so tests can reference them. Photos are placeholder images (picsum.photos).
 */
export function demoResortCatalog(tenantId: string): { categories: Category[]; offerings: Offering[]; resources: Resource[]; properties: Property[] } {
  const photo = (seed: string) => `https://picsum.photos/seed/${seed}/1200/800`;

  const properties: Property[] = [
    {
      id: "prop_palm",
      tenantId,
      name: { en: "Palm Lagoon Beach Resort", ar: "منتجع بالم لاغون الشاطئي" },
      description: { en: "Beachfront resort on Palm Jumeirah with a private beach, three pools and a kids' club.", ar: "منتجع على شاطئ نخلة جميرا مع شاطئ خاص وثلاثة مسابح ونادٍ للأطفال." },
      address: "Crescent Road West, Palm Jumeirah, Dubai",
      mapsUrl: "https://maps.google.com/?q=Palm+Jumeirah+Dubai",
      phone: "+971 4 000 1111",
      checkInTime: "15:00",
      checkOutTime: "12:00",
      amenities: ["Private beach", "3 pools", "Kids' club", "Spa", "Free parking", "Breakfast included"],
      imageUrls: [photo("palm-lagoon-1"), photo("palm-lagoon-2")],
      sortOrder: 1,
      isActive: true,
    },
    {
      id: "prop_hatta",
      tenantId,
      name: { en: "Hatta Mountain Lodge", ar: "نُزل حتا الجبلي" },
      description: { en: "Stone lodges above Hatta Dam with mountain views, hiking trails and a heated infinity pool.", ar: "أكواخ حجرية فوق سد حتا بإطلالات جبلية ومسارات للمشي ومسبح لا متناهٍ مُدفّأ." },
      address: "Hatta Dam Road, Hatta, Dubai",
      mapsUrl: "https://maps.google.com/?q=Hatta+Dam",
      phone: "+971 4 000 2222",
      checkInTime: "14:00",
      checkOutTime: "11:00",
      amenities: ["Infinity pool", "Hiking trails", "Kayaking nearby", "Fireplace", "Pet friendly"],
      imageUrls: [photo("hatta-lodge-1"), photo("hatta-lodge-2")],
      sortOrder: 2,
      isActive: true,
    },
    {
      id: "prop_dunes",
      tenantId,
      name: { en: "Liwa Dunes Desert Camp", ar: "مخيم كثبان ليوا الصحراوي" },
      description: { en: "Luxury tents at the edge of the Empty Quarter: dune drives, camel rides, stargazing and dinner under the sky.", ar: "خيام فاخرة على حافة الربع الخالي: رحلات الكثبان وركوب الجمال ومراقبة النجوم والعشاء تحت السماء." },
      address: "Liwa Oasis, Al Dhafra, Abu Dhabi",
      mapsUrl: "https://maps.google.com/?q=Liwa+Oasis",
      phone: "+971 2 000 3333",
      checkInTime: "16:00",
      checkOutTime: "10:00",
      amenities: ["Dune drives", "Camel rides", "Stargazing", "Dinner included", "Air-conditioned tents"],
      imageUrls: [photo("liwa-dunes-1"), photo("liwa-dunes-2")],
      sortOrder: 3,
      isActive: true,
    },
    {
      id: "prop_fujairah",
      tenantId,
      name: { en: "Fujairah Bay Dive Resort", ar: "منتجع خليج الفجيرة للغوص" },
      description: { en: "East-coast resort on Dibba bay with a PADI dive centre, snorkelling off the beach and a seafood grill.", ar: "منتجع على الساحل الشرقي في خليج دبا مع مركز غوص PADI وغطس من الشاطئ ومشاوي بحرية." },
      address: "Dibba Al Fujairah Corniche, Fujairah",
      mapsUrl: "https://maps.google.com/?q=Dibba+Al+Fujairah",
      phone: "+971 9 000 4444",
      checkInTime: "15:00",
      checkOutTime: "12:00",
      amenities: ["Dive centre", "Snorkelling", "Seafood grill", "Pool", "Free parking"],
      imageUrls: [photo("fujairah-bay-1"), photo("fujairah-bay-2")],
      sortOrder: 4,
      isActive: true,
    },
  ];

  const categories: Category[] = [
    { id: "cat_rooms", tenantId, name: { en: "Rooms", ar: "الغرف" }, sortOrder: 1, isActive: true },
    { id: "cat_villas", tenantId, name: { en: "Villas & suites", ar: "الفلل والأجنحة" }, sortOrder: 2, isActive: true },
    { id: "cat_tents", tenantId, name: { en: "Tents & lodges", ar: "الخيام والأكواخ" }, sortOrder: 3, isActive: true },
  ];

  const stay = (id: string, propertyId: string, categoryId: string, name: Offering["name"], priceMinor: number, maxGuests: number, units: number, sortOrder: number, description: Offering["description"], imageSeed: string): Offering => ({
    id,
    tenantId,
    categoryId,
    propertyId,
    type: "stay",
    name,
    description,
    priceMinor,
    currency: "AED",
    maxGuests,
    units,
    imageUrl: photo(imageSeed),
    sortOrder,
    isActive: true,
    modifierGroups: [],
  });

  const offerings: Offering[] = [
    stay("stay_palm_deluxe", "prop_palm", "cat_rooms", { en: "Deluxe Sea View Room", ar: "غرفة ديلوكس بإطلالة بحرية" }, 95000, 2, 20, 1, { en: "45 m², king bed, balcony facing the Gulf.", ar: "٤٥ م²، سرير كينغ، شرفة مطلة على الخليج." }, "palm-deluxe"),
    stay("stay_palm_family", "prop_palm", "cat_rooms", { en: "Family Room", ar: "غرفة عائلية" }, 140000, 4, 8, 2, { en: "Two connecting rooms, two bathrooms, garden access.", ar: "غرفتان متصلتان وحمّامان ومدخل إلى الحديقة." }, "palm-family"),
    stay("stay_palm_villa", "prop_palm", "cat_villas", { en: "Beach Villa with Pool", ar: "فيلا شاطئية مع مسبح" }, 450000, 6, 3, 3, { en: "Three bedrooms, private pool, butler on call.", ar: "ثلاث غرف نوم ومسبح خاص وخدمة بتلر." }, "palm-villa"),
    stay("stay_hatta_lodge", "prop_hatta", "cat_tents", { en: "Mountain Lodge", ar: "كوخ جبلي" }, 85000, 2, 10, 4, { en: "Stone lodge with terrace and fireplace, dam view.", ar: "كوخ حجري مع تراس ومدفأة وإطلالة على السد." }, "hatta-lodge"),
    stay("stay_hatta_family", "prop_hatta", "cat_tents", { en: "Family Lodge", ar: "كوخ عائلي" }, 130000, 5, 4, 5, { en: "Two bedrooms, kitchenette, large terrace.", ar: "غرفتا نوم ومطبخ صغير وتراس كبير." }, "hatta-family"),
    stay("stay_dunes_tent", "prop_dunes", "cat_tents", { en: "Luxury Tent", ar: "خيمة فاخرة" }, 120000, 2, 12, 6, { en: "Air-conditioned tent, en-suite bathroom, dinner and breakfast included.", ar: "خيمة مكيّفة مع حمّام خاص، العشاء والفطور مشمولان." }, "dunes-tent"),
    stay("stay_dunes_royal", "prop_dunes", "cat_villas", { en: "Royal Tent with Plunge Pool", ar: "خيمة ملكية مع مسبح صغير" }, 260000, 4, 3, 7, { en: "Two bedrooms, private plunge pool, dune-side deck.", ar: "غرفتا نوم ومسبح صغير خاص وسطح مطل على الكثبان." }, "dunes-royal"),
    stay("stay_fuj_standard", "prop_fujairah", "cat_rooms", { en: "Garden Room", ar: "غرفة حديقة" }, 55000, 2, 24, 8, { en: "32 m², twin or king, garden terrace.", ar: "٣٢ م²، سريران أو كينغ، تراس على الحديقة." }, "fujairah-garden"),
    stay("stay_fuj_sea", "prop_fujairah", "cat_rooms", { en: "Sea View Room", ar: "غرفة بإطلالة بحرية" }, 72000, 3, 16, 9, { en: "Balcony over the bay, steps from the dive centre.", ar: "شرفة على الخليج، خطوات من مركز الغوص." }, "fujairah-sea"),
    stay("stay_fuj_suite", "prop_fujairah", "cat_villas", { en: "Bay Suite", ar: "جناح الخليج" }, 160000, 4, 4, 10, { en: "Living room, two balconies, dive gear storage.", ar: "صالة وشرفتان وتخزين لمعدات الغوص." }, "fujairah-suite"),
  ];

  return { categories, offerings, resources: [], properties };
}
