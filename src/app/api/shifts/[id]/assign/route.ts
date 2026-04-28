import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkLaborLimits, WEEKLY_WARN_HOURS } from "@/lib/labor";
import { shiftLabel } from "@/lib/shiftLabel";
import { broadcast } from "@/lib/broadcast";
import { notify } from "@/lib/notify";
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
    prisma.shift.findUnique({ where: { id }, include: { assignments: true } }),
    request.json(),
  ]);
  if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });

  const assigneeId = String(body.assigneeId ?? "");
  const overrideReason: string | undefined = body.overrideReason ? String(body.overrideReason) : undefined;
  if (!assigneeId) return NextResponse.json({ error: "assigneeId required" }, { status: 400 });

  // Resolve location timezone for accurate local-hour and day-of-week extraction
  const location = await prisma.location.findUnique({
    where: { id: shift.locationId },
    select: { timezone: true },
  });
  const tz = location?.timezone ?? "UTC";

  const startLocal = getLocalParts(shift.startsAt, tz);
  const endLocal = getLocalParts(shift.endsAt, tz);
  const day = startLocal.dayOfWeek;
  const hourStart = startLocal.hour;
  const hourEnd = endLocal.hour;
  const overnight = isOvernightShift(shift.startsAt, shift.endsAt, tz);

  // Date window for querying exceptions: covers both start-day and (for overnight) end-day
  const shiftDateStart = new Date(`${startLocal.dateStr}T00:00:00Z`);
  const shiftDateEnd = new Date(overnight
    ? `${endLocal.dateStr}T23:59:59Z`
    : `${startLocal.dateStr}T23:59:59Z`);

  const [
    assignee,
    managerCert,
    assigneeCert,
    assigneeSkill,
    assignedShifts,
    exception,
    availWindow,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: assigneeId } }),
    user.role === "MANAGER"
      ? prisma.certification.findFirst({ where: { userId: user.id, locationId: shift.locationId } })
      : Promise.resolve(true),
    prisma.certification.findFirst({ where: { userId: assigneeId, locationId: shift.locationId } }),
    prisma.userSkill.findFirst({ where: { userId: assigneeId, skill: shift.requiredSkill } }),
    prisma.shiftAssignment.findMany({ where: { userId: assigneeId }, include: { shift: true } }),
    prisma.availabilityException.findFirst({
      where: { userId: assigneeId, date: { gte: shiftDateStart, lte: shiftDateEnd } },
    }),
    prisma.availabilityWindow.findMany({
      where: {
        userId: assigneeId,
        dayOfWeek: overnight ? { in: [day, endLocal.dayOfWeek] } : day,
      },
    }),
  ]);

  if (!managerCert) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!assignee) return NextResponse.json({ error: "Staff user not found" }, { status: 404 });
  if (!assigneeCert) return NextResponse.json({ reason: `${assignee.name} is not certified for this location` }, { status: 400 });
  if (!assigneeSkill) return NextResponse.json({ reason: `${assignee.name} lacks the required skill` }, { status: 400 });

  for (const row of assignedShifts) {
    if (row.shift.id === shift.id) continue;
    if (shift.startsAt < row.shift.endsAt && row.shift.startsAt < shift.endsAt) {
      return NextResponse.json({ reason: `${assignee.name} has an overlapping shift` }, { status: 400 });
    }
    const restBefore = (shift.startsAt.getTime() - row.shift.endsAt.getTime()) / 3600000;
    const restAfter = (row.shift.startsAt.getTime() - shift.endsAt.getTime()) / 3600000;
    if ((restBefore > 0 && restBefore < 10) || (restAfter > 0 && restAfter < 10)) {
      return NextResponse.json({ reason: `${assignee.name} violates the 10-hour rest rule` }, { status: 400 });
    }
  }

  const availWindows = Array.isArray(availWindow) ? availWindow : (availWindow ? [availWindow] : []);
  const startDayWindow = availWindows.find((w) => w.dayOfWeek === day);
  const endDayWindow = overnight ? availWindows.find((w) => w.dayOfWeek === endLocal.dayOfWeek) : null;

  if (exception) {
    if (exception.isOff) {
      return NextResponse.json({ reason: `${assignee.name} is marked unavailable on that date` }, { status: 400 });
    }
    if (
      exception.startHour !== null &&
      exception.endHour !== null &&
      hourStart < exception.startHour
    ) {
      return NextResponse.json({ reason: `${assignee.name} is outside their exception availability window` }, { status: 400 });
    }
  } else {
    // Check start-day window (mandatory)
    if (startDayWindow && hourStart < startDayWindow.startHour) {
      return NextResponse.json({ reason: `${assignee.name} is outside their availability window on ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][day]}` }, { status: 400 });
    }
    // For overnight shifts: check end-day window covers the ending hour if a window is set
    if (overnight && endDayWindow && hourEnd > endDayWindow.endHour) {
      return NextResponse.json({ reason: `${assignee.name}'s availability on the following day ends before this overnight shift finishes` }, { status: 400 });
    }
    // Non-overnight: ensure end hour doesn't exceed the window
    if (!overnight && startDayWindow && hourEnd > startDayWindow.endHour) {
      return NextResponse.json({ reason: `${assignee.name} is outside their availability window on ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][day]}` }, { status: 400 });
    }
  }

  // ── Labor law compliance ───────────────────────────────────────────
  const labor = await checkLaborLimits(prisma, assignee.name, assigneeId, shift);

  if (labor.hardBlocked) {
    const block = labor.warnings.find((w) => w.severity === "block");
    return NextResponse.json({ reason: block?.message ?? "Labor law violation — cannot assign" }, { status: 400 });
  }

  if (labor.requiresOverride) {
    if (!overrideReason || overrideReason.trim().length < 5) {
      return NextResponse.json(
        {
          reason: labor.warnings.find((w) => w.code === "CONSECUTIVE_7_BLOCK")?.message,
          requiresOverride: true,
        },
        { status: 400 },
      );
    }
  }

  const label = shiftLabel(shift.seqId, shift.startsAt, shift.endsAt);

  // ── Writes inside a transaction to prevent simultaneous-assign race conditions ─
  try {
    await prisma.$transaction(async (tx) => {
      // Re-check for overlaps inside the transaction (serializable read)
      const freshAssignments = await tx.shiftAssignment.findMany({
        where: { userId: assigneeId },
        include: { shift: true },
      });
      for (const row of freshAssignments) {
        if (row.shift.id === shift.id) continue;
        if (shift.startsAt < row.shift.endsAt && row.shift.startsAt < shift.endsAt) {
          throw new Error(`CONFLICT:${assignee.name} was simultaneously assigned to an overlapping shift by another manager. Refresh to see the latest state.`);
        }
      }
      await tx.shiftAssignment.upsert({
        where: { shiftId_userId: { shiftId: shift.id, userId: assigneeId } },
        create: { shiftId: shift.id, userId: assigneeId },
        update: {},
      });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.startsWith("CONFLICT:")) {
      return NextResponse.json({ reason: msg.slice(9) }, { status: 409 });
    }
    throw err;
  }

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "SHIFT_ASSIGNED",
      after: JSON.parse(
        JSON.stringify({
          shiftId: shift.id,
          locationId: shift.locationId,
          assigneeId,
          assigneeName: assignee.name,
          laborWarnings: labor.warnings.map((w) => w.code),
          overrideReason: overrideReason ?? null,
        }),
      ),
    },
  });

  // ── Notifications (via central helper — respects notifPref) ────────
  const notifBatch = [
    {
      userId: assigneeId,
      title: "New shift assignment",
      body: `You have been assigned to ${label} by ${user.name}.`,
    },
  ];

  // Warn the acting manager if the assignment pushes staff into overtime
  if (labor.warnings.some((w) => w.severity === "warn") && labor.projectedWeeklyHours >= WEEKLY_WARN_HOURS) {
    notifBatch.push({
      userId: user.id,
      title: "Overtime warning",
      body: `${assignee.name} will reach ${Math.round(labor.projectedWeeklyHours * 10) / 10} hrs this week after ${label}.`,
    });
  }

  await notify(notifBatch);

  const existingIds = shift.assignments.map((a) => a.userId);
  const assigneeIds = existingIds.includes(assigneeId) ? existingIds : [...existingIds, assigneeId];

  broadcast("shift_update", { shiftId: shift.id, action: "assigned" });

  return NextResponse.json({
    shift: {
      id: shift.id,
      locationId: shift.locationId,
      requiredSkill: shift.requiredSkill,
      headcountNeeded: shift.headcountNeeded,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      published: shift.published,
      assigneeIds,
    },
    laborWarnings: labor.warnings,
  });
}
