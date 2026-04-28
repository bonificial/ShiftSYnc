import { PrismaClient } from "@prisma/client";

export const HOURLY_RATE = 15;
export const OVERTIME_MULTIPLIER = 1.5;
export const WEEKLY_WARN_HOURS = 35;
export const WEEKLY_MAX_HOURS = 40;
export const DAILY_WARN_HOURS = 8;
export const DAILY_MAX_HOURS = 12;

export type LaborWarning = {
  code: string;
  message: string;
  severity: "warn" | "block";
};

export type LaborCheck = {
  warnings: LaborWarning[];
  projectedDailyHours: number;
  projectedWeeklyHours: number;
  consecutiveDays: number;
  requiresOverride: boolean;
  hardBlocked: boolean;
};

function isoDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getISOWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function checkLaborLimits(
  prisma: PrismaClient,
  assigneeName: string,
  assigneeId: string,
  shift: { id: string; startsAt: Date; endsAt: Date },
): Promise<LaborCheck> {
  const warnings: LaborWarning[] = [];
  const shiftDuration = (shift.endsAt.getTime() - shift.startsAt.getTime()) / 3600000;

  const dayStart = new Date(
    Date.UTC(shift.startsAt.getUTCFullYear(), shift.startsAt.getUTCMonth(), shift.startsAt.getUTCDate()),
  );
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const weekStart = getISOWeekStart(shift.startsAt);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
  const lookbackStart = new Date(dayStart.getTime() - 7 * 86400000);

  const [dayAssignments, weekAssignments, recentAssignments] = await Promise.all([
    prisma.shiftAssignment.findMany({
      where: { userId: assigneeId, shift: { id: { not: shift.id }, startsAt: { gte: dayStart, lt: dayEnd } } },
      include: { shift: { select: { startsAt: true, endsAt: true } } },
    }),
    prisma.shiftAssignment.findMany({
      where: { userId: assigneeId, shift: { id: { not: shift.id }, startsAt: { gte: weekStart, lt: weekEnd } } },
      include: { shift: { select: { startsAt: true, endsAt: true } } },
    }),
    prisma.shiftAssignment.findMany({
      where: { userId: assigneeId, shift: { startsAt: { gte: lookbackStart, lt: dayEnd } } },
      include: { shift: { select: { startsAt: true } } },
    }),
  ]);

  // ── Daily check ────────────────────────────────────────────────────
  const dailyExistingHours = dayAssignments.reduce(
    (sum, a) => sum + (a.shift.endsAt.getTime() - a.shift.startsAt.getTime()) / 3600000,
    0,
  );
  const projectedDailyHours = dailyExistingHours + shiftDuration;

  if (projectedDailyHours > DAILY_MAX_HOURS) {
    warnings.push({
      code: "DAILY_12H_BLOCK",
      message: `${assigneeName} would work ${projectedDailyHours.toFixed(1)}h in one day — exceeds the 12-hour maximum.`,
      severity: "block",
    });
  } else if (projectedDailyHours > DAILY_WARN_HOURS) {
    warnings.push({
      code: "DAILY_8H_WARN",
      message: `${assigneeName} would work ${projectedDailyHours.toFixed(1)}h in one day (over 8h).`,
      severity: "warn",
    });
  }

  // ── Weekly check ───────────────────────────────────────────────────
  const weeklyExistingHours = weekAssignments.reduce(
    (sum, a) => sum + (a.shift.endsAt.getTime() - a.shift.startsAt.getTime()) / 3600000,
    0,
  );
  const projectedWeeklyHours = weeklyExistingHours + shiftDuration;

  if (projectedWeeklyHours > WEEKLY_MAX_HOURS) {
    warnings.push({
      code: "WEEKLY_40H_WARN",
      message: `${assigneeName} would reach ${projectedWeeklyHours.toFixed(1)}h this week — overtime territory.`,
      severity: "warn",
    });
  } else if (projectedWeeklyHours >= WEEKLY_WARN_HOURS) {
    warnings.push({
      code: "WEEKLY_35H_WARN",
      message: `${assigneeName} would have ${projectedWeeklyHours.toFixed(1)}h this week — approaching 40h limit.`,
      severity: "warn",
    });
  }

  // ── Consecutive days check ────────────────────────────────────────
  const workedDayKeys = new Set(recentAssignments.map((a) => isoDateKey(a.shift.startsAt)));
  workedDayKeys.add(isoDateKey(shift.startsAt));

  let consecutiveDays = 0;
  for (let i = 0; i <= 7; i++) {
    const d = new Date(dayStart.getTime() - i * 86400000);
    if (workedDayKeys.has(isoDateKey(d))) {
      consecutiveDays++;
    } else {
      break;
    }
  }

  if (consecutiveDays >= 7) {
    warnings.push({
      code: "CONSECUTIVE_7_BLOCK",
      message: `${assigneeName} would work a 7th consecutive day — manager override with a documented reason is required.`,
      severity: "block",
    });
  } else if (consecutiveDays >= 6) {
    warnings.push({
      code: "CONSECUTIVE_6_WARN",
      message: `${assigneeName} would work their 6th consecutive day.`,
      severity: "warn",
    });
  }

  const hardBlocked = warnings.some((w) => w.severity === "block" && w.code !== "CONSECUTIVE_7_BLOCK");
  const requiresOverride = warnings.some((w) => w.code === "CONSECUTIVE_7_BLOCK");

  return { warnings, projectedDailyHours, projectedWeeklyHours, consecutiveDays, requiresOverride, hardBlocked };
}

export function projectedCost(totalHours: number): number {
  const regular = Math.min(totalHours, WEEKLY_MAX_HOURS);
  const overtime = Math.max(0, totalHours - WEEKLY_MAX_HOURS);
  return Math.round((regular * HOURLY_RATE + overtime * HOURLY_RATE * OVERTIME_MULTIPLIER) * 100) / 100;
}
