import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkLaborLimits } from "@/lib/labor";
import { getLocalParts, isOvernightShift } from "@/lib/tz";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const [user, { id }] = await Promise.all([currentUser(), context.params]);
  if (!user || !["ADMIN", "MANAGER"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [shift, body] = await Promise.all([
    prisma.shift.findUnique({ where: { id } }),
    request.json(),
  ]);
  if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });

  const assigneeId = String(body.assigneeId ?? "");
  if (!assigneeId) return NextResponse.json({ error: "assigneeId required" }, { status: 400 });

  const [assignee, cert, skill, existingAssignments, locationRow] = await Promise.all([
    prisma.user.findUnique({ where: { id: assigneeId }, select: { id: true, name: true } }),
    prisma.certification.findFirst({ where: { userId: assigneeId, locationId: shift.locationId } }),
    prisma.userSkill.findFirst({ where: { userId: assigneeId, skill: shift.requiredSkill } }),
    prisma.shiftAssignment.findMany({ where: { userId: assigneeId }, include: { shift: true } }),
    prisma.location.findUnique({ where: { id: shift.locationId }, select: { timezone: true } }),
  ]);

  const tz = locationRow?.timezone ?? "UTC";
  const startLocal = getLocalParts(shift.startsAt, tz);
  const endLocal = getLocalParts(shift.endsAt, tz);
  const overnight = isOvernightShift(shift.startsAt, shift.endsAt, tz);

  if (!assignee) return NextResponse.json({ error: "Staff not found" }, { status: 404 });

  const preChecks: { code: string; message: string; severity: "warn" | "block" }[] = [];

  if (!cert) {
    preChecks.push({ code: "NO_CERT", message: `${assignee.name} is not certified for this location.`, severity: "block" });
  }
  if (!skill) {
    preChecks.push({ code: "NO_SKILL", message: `${assignee.name} lacks the required skill.`, severity: "block" });
  }

  for (const row of existingAssignments) {
    if (row.shift.id === shift.id) continue;
    if (shift.startsAt < row.shift.endsAt && row.shift.startsAt < shift.endsAt) {
      preChecks.push({ code: "OVERLAP", message: `${assignee.name} has an overlapping shift.`, severity: "block" });
      break;
    }
    const restBefore = (shift.startsAt.getTime() - row.shift.endsAt.getTime()) / 3600000;
    const restAfter = (row.shift.startsAt.getTime() - shift.endsAt.getTime()) / 3600000;
    if ((restBefore > 0 && restBefore < 10) || (restAfter > 0 && restAfter < 10)) {
      preChecks.push({ code: "REST_VIOLATION", message: `${assignee.name} violates the 10-hour rest rule.`, severity: "block" });
      break;
    }
  }

  // Availability window check (timezone-aware)
  const availWindows = await prisma.availabilityWindow.findMany({
    where: {
      userId: assigneeId,
      dayOfWeek: overnight
        ? { in: [startLocal.dayOfWeek, endLocal.dayOfWeek] }
        : startLocal.dayOfWeek,
    },
  });
  const startWin = availWindows.find((w) => w.dayOfWeek === startLocal.dayOfWeek);
  const endWin = overnight ? availWindows.find((w) => w.dayOfWeek === endLocal.dayOfWeek) : null;
  const DAY_ABBR = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  if (startWin && startLocal.hour < startWin.startHour) {
    preChecks.push({ code: "AVAIL_START", message: `${assignee?.name} is outside their availability window on ${DAY_ABBR[startLocal.dayOfWeek]}.`, severity: "warn" });
  }
  if (!overnight && startWin && endLocal.hour > startWin.endHour) {
    preChecks.push({ code: "AVAIL_END", message: `${assignee?.name}'s availability ends before this shift on ${DAY_ABBR[startLocal.dayOfWeek]}.`, severity: "warn" });
  }
  if (overnight && endWin && endLocal.hour > endWin.endHour) {
    preChecks.push({ code: "AVAIL_OVERNIGHT_END", message: `${assignee?.name}'s availability the following day ends before this overnight shift finishes.`, severity: "warn" });
  }

  if (preChecks.some((c) => c.severity === "block")) {
    return NextResponse.json({
      assigneeName: assignee.name,
      warnings: preChecks,
      projectedDailyHours: 0,
      projectedWeeklyHours: 0,
      consecutiveDays: 0,
      requiresOverride: false,
      hardBlocked: true,
    });
  }

  const laborCheck = await checkLaborLimits(prisma, assignee.name, assigneeId, shift);

  return NextResponse.json({
    assigneeName: assignee.name,
    warnings: [...preChecks, ...laborCheck.warnings],
    projectedDailyHours: laborCheck.projectedDailyHours,
    projectedWeeklyHours: laborCheck.projectedWeeklyHours,
    consecutiveDays: laborCheck.consecutiveDays,
    requiresOverride: laborCheck.requiresOverride,
    hardBlocked: laborCheck.hardBlocked,
  });
}
