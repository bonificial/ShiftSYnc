/**
 * Timezone utilities.
 * Uses the IANA Intl API — works in Node.js (server) and browsers (client).
 * All inputs are UTC Date objects; outputs are in the given IANA timezone.
 */

export type LocalParts = {
  hour: number;        // 0–23 in local time
  dayOfWeek: number;   // 0 = Sunday … 6 = Saturday
  dateStr: string;     // "YYYY-MM-DD" in local time
};

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Decompose a UTC Date into local parts for a given IANA timezone.
 * Handles DST automatically via Intl.
 */
export function getLocalParts(date: Date, timezone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const raw = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));

  // In some environments hour12:false returns "24" for midnight — normalise to 0
  const hour = raw.hour === "24" ? 0 : Number(raw.hour);
  const dayOfWeek = DOW.indexOf(raw.weekday ?? "");

  return {
    hour,
    dayOfWeek: dayOfWeek === -1 ? date.getUTCDay() : dayOfWeek,
    dateStr: `${raw.year}-${raw.month}-${raw.day}`,
  };
}

/**
 * Format a UTC Date for display in the given IANA timezone.
 * Returns something like "Apr 28, 11:00 PM".
 */
export function fmtInTz(date: Date, timezone: string): string {
  return date.toLocaleString("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Returns true when a shift starts and ends on different calendar days
 * in the given timezone (i.e. crosses midnight locally — an overnight shift).
 */
export function isOvernightShift(startsAt: Date, endsAt: Date, timezone: string): boolean {
  return getLocalParts(startsAt, timezone).dateStr !== getLocalParts(endsAt, timezone).dateStr;
}

/**
 * Format a shift's time range for display.
 * For overnight shifts adds a "+1" label on the end time.
 *   e.g. "Apr 28, 11:00 PM → 3:00 AM (+1)"
 */
export function fmtShiftRange(startsAt: Date, endsAt: Date, timezone: string): string {
  const start = fmtInTz(startsAt, timezone);
  const end = endsAt.toLocaleString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const suffix = isOvernightShift(startsAt, endsAt, timezone) ? " (+1)" : "";
  return `${start} → ${end}${suffix}`;
}

/**
 * Abbreviation of the timezone offset for display (e.g. "EDT", "PST").
 */
export function tzAbbr(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "short",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? timezone;
  } catch {
    return timezone;
  }
}
