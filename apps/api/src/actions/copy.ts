/** Small localized strings used by action handlers when composing text for the customer. */
export const COPY = {
  handoff: { en: "One of our team will reply here shortly.", ar: "سيرد عليك أحد أعضاء فريقنا هنا قريباً." },
  handoffWaiting: {
    en: "Thanks, your message has reached our team and a person will reply to you here. Send *menu* any time to go back to the assistant.",
    ar: "شكراً، وصلت رسالتك إلى فريقنا وسيرد عليك أحد الموظفين هنا. أرسل *القائمة* في أي وقت للعودة إلى المساعد.",
  },
  handoffResumed: {
    en: "Sorry for the wait, nobody from the team has been able to pick this up yet, so I'm back to help in the meantime.",
    ar: "عذراً على الانتظار، لم يتمكن أحد من الفريق من الرد حتى الآن، لذا عدتُ لمساعدتك في هذه الأثناء.",
  },
  cartTitle: { en: "Your cart:", ar: "سلتك:" },
  cartEmpty: { en: "Your cart is empty.", ar: "سلتك فارغة." },
  subtotal: { en: "Subtotal", ar: "المجموع الفرعي" },
  deliveryFee: { en: "Delivery", ar: "التوصيل" },
  vatIncluded: { en: "Includes VAT", ar: "شامل ضريبة القيمة المضافة" },
  vat: { en: "VAT", ar: "ضريبة القيمة المضافة" },
  total: { en: "Total", ar: "الإجمالي" },
  noThanks: { en: "No thanks", ar: "لا شكراً" },
  orderPlaced: { en: "Order #{{number}} placed. Thank you!", ar: "تم تسجيل الطلب رقم {{number}}. شكراً لك!" },
  payCashDelivery: { en: "Please pay {{total}} in cash on delivery.", ar: "يرجى دفع {{total}} نقداً عند التوصيل." },
  payCashPickup: { en: "Please pay {{total}} when you collect your order.", ar: "يرجى دفع {{total}} عند استلام طلبك." },
  weWillUpdate: { en: "We will message you here as your order progresses.", ar: "سنرسل لك التحديثات هنا مع تقدم طلبك." },
  orderStatus: { en: "Order #{{number}} is *{{status}}*. Total {{total}}.", ar: "الطلب رقم {{number}} حالته: *{{status}}*. الإجمالي {{total}}." },
  bookingStatus: { en: "Your booking on *{{when}}* is *{{status}}*.", ar: "حجزك في *{{when}}* حالته: *{{status}}*." },
  stayStatus: { en: "Your stay at {{property}}, *{{from}}* to *{{to}}*, is *{{status}}*.", ar: "إقامتك في {{property}}، من *{{from}}* إلى *{{to}}*، حالتها: *{{status}}*." },
  stayReminder: { en: "Reminder: your stay at {{tenant}} starts *{{when}}*. Reply here if anything changes.", ar: "تذكير: تبدأ إقامتك في {{tenant}} *{{when}}*. راسلنا هنا إذا تغيّر أي شيء." },
  bookingReminder: { en: "Reminder: your booking at {{tenant}} is on *{{when}}*. Reply here if you need to change it.", ar: "تذكير: حجزك في {{tenant}} في *{{when}}*. راسلنا هنا إذا أردت تغييره." },
  minutes: { en: "min", ar: "دقيقة" },
  anyone: { en: "Anyone available", ar: "أي موظف متاح" },
  bookingPlaced: {
    en: "Booked! {{service}} with {{staff}} on {{when}}. Total {{total}}. We will confirm shortly and remind you before your visit.",
    ar: "تم الحجز! {{service}} مع {{staff}} في {{when}}. الإجمالي {{total}}. سنؤكد الحجز قريباً ونذكّرك قبل موعدك.",
  },
  bookingCancelled: { en: "Your booking on {{when}} has been cancelled.", ar: "تم إلغاء حجزك في {{when}}." },
  cannotCancel: { en: "This booking can no longer be cancelled here. Send \"agent\" and we will help.", ar: "لا يمكن إلغاء هذا الحجز هنا. أرسل \"موظف\" وسنساعدك." },
  noUpcoming: { en: "You have no upcoming bookings. Send \"menu\" to book one.", ar: "ليس لديك حجوزات قادمة. أرسل \"القائمة\" للحجز." },
  statuses: {
    en: {
      placed: "received and waiting for confirmation",
      accepted: "confirmed",
      preparing: "being prepared",
      ready: "ready",
      out_for_delivery: "on its way",
      delivered: "delivered",
      completed: "completed",
      cancelled: "cancelled",
      rejected: "rejected",
      requested: "requested and waiting for confirmation",
      confirmed: "confirmed",
      checked_in: "checked in",
      in_progress: "in progress",
      no_show: "marked as a no-show",
      checked_out: "checked out",
    },
    ar: {
      placed: "تم استلامه وبانتظار التأكيد",
      accepted: "مؤكد",
      preparing: "قيد التحضير",
      ready: "جاهز",
      out_for_delivery: "في الطريق إليك",
      delivered: "تم التوصيل",
      completed: "مكتمل",
      cancelled: "ملغي",
      rejected: "مرفوض",
      requested: "تم طلبه وبانتظار التأكيد",
      confirmed: "مؤكد",
      checked_in: "تم تسجيل الوصول",
      in_progress: "جارٍ",
      no_show: "لم يتم الحضور",
      checked_out: "تم تسجيل المغادرة",
    },
  } as Record<string, Record<string, string>>,
} as const;

type Copy = Record<string, string>;

export function t(copy: Copy, language: string, vars: Record<string, string | number> = {}): string {
  const template = copy[language] ?? copy.en ?? Object.values(copy)[0] ?? "";
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ""));
}

export function statusLabel(status: string, language: string): string {
  return COPY.statuses[language]?.[status] ?? COPY.statuses.en?.[status] ?? status.replace(/_/g, " ");
}
