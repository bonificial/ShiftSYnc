import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { expireStaleDrops } from "@/lib/expiry";
import { projectedCost, HOURLY_RATE, OVERTIME_MULTIPLIER, WEEKLY_MAX_HOURS, WEEKLY_WARN_HOURS } from "@/lib/labor";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await expireStaleDrops(prisma);

  const managedLocationIds =
    user.role === "MANAGER"
      ? (
          await prisma.certification.findMany({
            where: { userId: user.id },
            select: { locationId: true },
          })
        ).map((c) => c.locationId)
      : [];

  const shiftWhere =
    user.role === "STAFF"
      ? { assignments: { some: { userId: user.id } } }
      : user.role === "MANAGER"
        ? { locationId: { in: managedLocationIds } }
        : {};

  // Current ISO week bounds
  const now = new Date();
  const day = now.getUTCDay();
  const weekStart = new Date(now);
  weekStart.setUTCDate(now.getUTCDate() - (day === 0 ? 6 : day - 1));
  weekStart.setUTCHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);

  const [shiftsRaw, swaps, notifications, pendingSwaps, onDutyAssignments, weekAssignments, allLocations] =
    await Promise.all([
      prisma.shift.findMany({
        where: shiftWhere,
        include: { assignments: { include: { user: { select: { id: true, name: true } } } } },
        orderBy: { startsAt: "asc" },
        take: 20,
      }),
      prisma.swapRequest.findMany({
        where:
          user.role === "STAFF"
            ? { OR: [{ requesterId: user.id }, { targetUserId: user.id }] }
            : {},
        include: {
          requester: { select: { name: true } },
          targetUser: { select: { name: true } },
          shift: { select: { startsAt: true, endsAt: true, locationId: true, requiredSkill: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.swapRequest.count({
        where: { status: { in: ["PENDING_PARTY_ACCEPTANCE", "PENDING_MANAGER_APPROVAL"] } },
      }),
      // Staff currently on duty right now
      prisma.shiftAssignment.findMany({
        where: { shift: { startsAt: { lte: now }, endsAt: { gte: now } } },
        include: {
          user: { select: { id: true, name: true } },
          shift: { select: { locationId: true } },
        },
      }),
      // All assignments this ISO week for overtime analysis
      prisma.shiftAssignment.findMany({
        where: { shift: { startsAt: { gte: weekStart, lt: weekEnd } } },

        include: {
          shift: { select: { id: true, startsAt: true, endsAt: true, locationId: true, requiredSkill: true } },
          user: { select: { id: true, name: true, role: true, desiredHours: true } },
        },
      }),
      prisma.location.findMany({ select: { id: true, name: true, timezone: true } }),
    ]);

  const shifts = shiftsRaw.map((s) => ({
    id: s.id,
    seqId: s.seqId,
    locationId: s.locationId,
    requiredSkill: s.requiredSkill,
    headcountNeeded: s.headcountNeeded,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    published: s.published,
    assigneeIds: s.assignments.map((a) => a.userId),
    assigneeNames: s.assignments.map((a) => a.user?.name ?? "Unknown"),
  }));

  const openShifts = shiftsRaw.filter((s) => s.assignments.length < s.headcountNeeded).length;

  // ── Overtime analytics ────────────────────────────────────────────
  type StaffData = {
    name: string;
    desiredHours: number;
    totalHours: number;
    shifts: { shiftId: string; hours: number; pushesIntoOvertime: boolean }[];
  };
  const staffMap = new Map<string, StaffData>();

  // Sort assignments by shift start so we can flag the exact shift that crosses a threshold
  const sorted = [...weekAssignments]
    .filter((a) => a.user.role === "STAFF")
    .sort((a, b) => a.shift.startsAt.getTime() - b.shift.startsAt.getTime());

  for (const row of sorted) {
    const duration = Math.max(0, (row.shift.endsAt.getTime() - row.shift.startsAt.getTime()) / 3600000);
    const prev = staffMap.get(row.user.id);
    if (prev) {
      const before = prev.totalHours;
      const after = before + duration;
      prev.shifts.push({
        shiftId: row.shift.id,
        hours: duration,
        pushesIntoOvertime: before < WEEKLY_MAX_HOURS && after > WEEKLY_MAX_HOURS,
      });
      prev.totalHours = after;
    } else {
      staffMap.set(row.user.id, {
        name: row.user.name,
        desiredHours: row.user.desiredHours,
        totalHours: duration,
        shifts: [{ shiftId: row.shift.id, hours: duration, pushesIntoOvertime: false }],
      });
    }
  }

  const overtime = Array.from(staffMap.entries()).map(([userId, data]) => {
    const totalHours = Math.round(data.totalHours * 10) / 10;
    const cost = projectedCost(data.totalHours);
    return {
      userId,
      name: data.name,
      totalHours,
      desiredHours: data.desiredHours,
      warning: totalHours >= WEEKLY_WARN_HOURS,
      overLimit: totalHours > WEEKLY_MAX_HOURS,
      projectedCost: cost,
      overtimeHours: Math.max(0, Math.round((data.totalHours - WEEKLY_MAX_HOURS) * 10) / 10),
      shifts: data.shifts,
    };
  });

  const overtimeRisks = overtime.filter((x) => x.warning).length;
  const totalProjectedCost = overtime.reduce((s, x) => s + x.projectedCost, 0);

  // ── Fairness: shift distribution per staff this week ──────────────
  // Counts shifts by skill & location per person so managers can audit bias
  type FairnessRow = {
    userId: string; name: string;
    shiftCount: number; totalHours: number;
    bySkill: Record<string, number>;
    byLocation: Record<string, number>;
  };
  const fairnessMap = new Map<string, FairnessRow>();
  for (const row of sorted) {
    const duration = Math.max(0, (row.shift.endsAt.getTime() - row.shift.startsAt.getTime()) / 3600000);
    const existing = fairnessMap.get(row.user.id);
    if (existing) {
      existing.shiftCount++;
      existing.totalHours += duration;
      existing.bySkill[row.shift.requiredSkill] = (existing.bySkill[row.shift.requiredSkill] ?? 0) + 1;
      existing.byLocation[row.shift.locationId] = (existing.byLocation[row.shift.locationId] ?? 0) + 1;
    } else {
      fairnessMap.set(row.user.id, {
        userId: row.user.id,
        name: row.user.name,
        shiftCount: 1,
        totalHours: duration,
        bySkill: { [row.shift.requiredSkill]: 1 },
        byLocation: { [row.shift.locationId]: 1 },
      });
    }
  }
  const fairness = Array.from(fairnessMap.values()).sort((a, b) => b.shiftCount - a.shiftCount);

  // ── On-duty now: group by location ────────────────────────────────
  const onDutyByLocation: Record<string, { userId: string; name: string }[]> = {};
  for (const a of onDutyAssignments) {
    const locId = a.shift.locationId;
    if (!onDutyByLocation[locId]) onDutyByLocation[locId] = [];
    onDutyByLocation[locId].push({ userId: a.user.id, name: a.user.name });
  }
  const onDutyNow = onDutyAssignments.length;

  return NextResponse.json(
    {
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        email: user.email,
        locations: user.role === "ADMIN"
          ? ["All Locations"]
          : managedLocationIds.map((lid) => lid === "l-east" ? "Harbor View" : lid === "l-west" ? "Pier Grill" : lid),
      },
      summary: { openShifts, pendingSwaps, overtimeRisks, onDutyNow },
      onDutyByLocation,
      shifts,
      swaps: swaps.map((s) => ({
        id: s.id,
        shiftId: s.shiftId,
        type: s.type,
        status: s.status,
        requesterId: s.requesterId,
        requesterName: s.requester.name,
        targetUserId: s.targetUserId ?? undefined,
        targetUserName: s.targetUser?.name ?? undefined,
        startsAt: s.shift.startsAt,
        endsAt: s.shift.endsAt,
        locationId: s.shift.locationId,
        requiredSkill: s.shift.requiredSkill,
      })),
      notifications,
      analytics: {
        overtime: user.role === "STAFF" ? [] : overtime,
        totalProjectedCost: user.role === "STAFF" ? 0 : Math.round(totalProjectedCost * 100) / 100,
        rates: { hourly: HOURLY_RATE, overtimeMultiplier: OVERTIME_MULTIPLIER },
        fairness: user.role === "STAFF" ? [] : fairness,
      },
      locations: Object.fromEntries(
        allLocations.map((l) => [l.id, { name: l.name, timezone: l.timezone }]),
      ),
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } },
  );
}
