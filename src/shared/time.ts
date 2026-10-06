/** `12.34`, `1:02.34`, or `DNF`. */
export function formatTime(
  ms: number | null | undefined,
  options: { decimals?: number } = {},
): string {
  if (ms === undefined) return "—";
  if (ms === null) return "DNF";
  const decimals = options.decimals ?? 2;
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  if (minutes === 0) return seconds.toFixed(decimals);
  return `${minutes}:${seconds.toFixed(decimals).padStart(decimals + 3, "0")}`;
}

export const DATE_FORMATS = ["locale", "dd/mm/yyyy", "mm/dd/yyyy", "yyyy-mm-dd", "dd.mm.yyyy"] as const;
export const TIME_FORMATS = ["locale", "24h", "12h"] as const;
export type DateFormat = typeof DATE_FORMATS[number];
export type TimeFormat = typeof TIME_FORMATS[number];
export type DateTimePreferences = { dateFormat: DateFormat; timeFormat: TimeFormat; timeZone?: string };

/** Empty means the browser's detected time zone. */
export function normaliseTimeZone(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try { new Intl.DateTimeFormat(undefined, { timeZone: value }); return value; }
  catch { return ""; }
}

export function availableTimeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  return [...new Set(["UTC", Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...(intl.supportedValuesOf?.("timeZone") ?? ["Europe/Oslo", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney"])])].sort();
}

function calendarParts(at: number, timeZone?: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || undefined, calendar: "gregory", numberingSystem: "latn",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

/** UTC epoch milliseconds become calendar values only at the presentation boundary. */
export function formatDate(at: number, format: DateFormat = "locale", timeZone?: string): string {
  if (format === "locale") return new Date(at).toLocaleDateString(undefined, { timeZone: timeZone || undefined });
  const { day, month, year } = calendarParts(at, timeZone);
  switch (format) {
    case "dd/mm/yyyy": return `${day}/${month}/${year}`;
    case "mm/dd/yyyy": return `${month}/${day}/${year}`;
    case "yyyy-mm-dd": return `${year}-${month}-${day}`;
    case "dd.mm.yyyy": return `${day}.${month}.${year}`;
  }
}

export function formatDateTime(at: number, preferences: DateTimePreferences): string {
  const date = new Date(at);
  const timeZone = preferences.timeZone || undefined;
  if (preferences.dateFormat === "locale" && preferences.timeFormat === "locale") return date.toLocaleString(undefined, { timeZone });
  const { hour, minute, second } = calendarParts(at, timeZone);
  const hours = Number(hour);
  const time = preferences.timeFormat === "24h" ? `${hour}:${minute}:${second}`
    : preferences.timeFormat === "12h" ? `${hours % 12 || 12}:${minute}:${second} ${hours < 12 ? "AM" : "PM"}`
    : date.toLocaleTimeString(undefined, { timeZone });
  return `${formatDate(at, preferences.dateFormat, timeZone)}, ${time}`;
}
