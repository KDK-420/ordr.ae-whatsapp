/** Human labels for dates and times in the tenant's zone, Latin digits in both languages. */

const locale = (language: string) => (language === "ar" ? "ar-AE-u-nu-latn" : "en-GB");

export function formatDay(dateKey: string, tz: string, language: string): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  // Noon UTC is the same calendar day in every zone between UTC-11 and UTC+11.
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat(locale(language), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(at);
}

export function formatTime(at: Date, tz: string, language: string): string {
  return new Intl.DateTimeFormat(locale(language), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(at);
}

export function formatWhen(at: Date, tz: string, language: string): string {
  const day = new Intl.DateTimeFormat(locale(language), { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(at);
  return `${day}, ${formatTime(at, tz, language)}`;
}
