const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function fmtTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h < 12 ? "am" : "pm";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${ampm}` : `${hour12}:${m.toString().padStart(2, "0")}${ampm}`;
}

function fmtDay(d: Date): string {
  return `${ordinal(d.getDate())}/${MONTHS[d.getMonth()]}/${d.getFullYear()}`;
}

export function shiftLabel(
  seqId: number,
  startsAt: Date,
  endsAt: Date,
): string {
  const sameDay =
    startsAt.getFullYear() === endsAt.getFullYear() &&
    startsAt.getMonth() === endsAt.getMonth() &&
    startsAt.getDate() === endsAt.getDate();

  if (sameDay) {
    return `Shift #${seqId} · ${fmtDay(startsAt)} ${fmtTime(startsAt)} – ${fmtTime(endsAt)}`;
  }
  return `Shift #${seqId} · ${fmtDay(startsAt)} ${fmtTime(startsAt)} – ${fmtDay(endsAt)} ${fmtTime(endsAt)}`;
}

/** Shorter version for tight spaces (no date, just time range with shift number) */
export function shiftLabelShort(seqId: number, startsAt: Date, endsAt: Date): string {
  return `#${seqId} ${fmtTime(startsAt)}–${fmtTime(endsAt)}`;
}
