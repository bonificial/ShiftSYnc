import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const GET = withAuth(["ADMIN", "MANAGER", "STAFF"], async (user) => {
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

  const shifts = await prisma.shift.findMany({
    where: shiftWhere,
    include: { assignments: true },
    orderBy: { startsAt: "asc" },
    take: 10,
  });
  const openShifts = shifts.filter((s) => s.assignments.length < s.headcountNeeded).length;
  const [pendingSwaps, allAssignments] = await Promise.all([
    prisma.swapRequest.count({
      where: {
        status: { in: ["PENDING_PARTY_ACCEPTANCE", "PENDING_MANAGER_APPROVAL"] },
      },
    }),
    prisma.shiftAssignment.findMany({
      include: { shift: true, user: { select: { role: true } } },
    }),
  ]);
  const staffHours = new Map<string, number>();
  for (const row of allAssignments) {
    if (row.user.role !== "STAFF") continue;
    const duration = (row.shift.endsAt.getTime() - row.shift.startsAt.getTime()) / 3600000;
    staffHours.set(row.userId, (staffHours.get(row.userId) ?? 0) + Math.max(duration, 0));
  }
  const overtimeRisks = Array.from(staffHours.values()).filter((hours) => hours >= 35).length;
  const now = new Date();
  const onDutyNow = await prisma.shift.count({
    where: {
      startsAt: { lte: now },
      endsAt: { gte: now },
      ...(user.role === "MANAGER" ? { locationId: { in: managedLocationIds } } : {}),
      ...(user.role === "STAFF" ? { assignments: { some: { userId: user.id } } } : {}),
    },
  });
  const swaps = await prisma.swapRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return NextResponse.json({
    summary: { openShifts, pendingSwaps, overtimeRisks, onDutyNow },
    shifts: shifts.map((s) => ({
      id: s.id,
      locationId: s.locationId,
      requiredSkill: s.requiredSkill,
      headcountNeeded: s.headcountNeeded,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      published: s.published,
      assigneeIds: s.assignments.map((a) => a.userId),
    })),
    swaps,
  });
});
