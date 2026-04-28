import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { shiftLabel } from "@/lib/shiftLabel";
import { broadcast } from "@/lib/broadcast";
import { notify } from "@/lib/notify";

const CUTOFF_HOURS = 48;

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user || !["ADMIN", "MANAGER"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "publish");
  const locationId = String(body.locationId ?? "");
  const weekStart = body.weekStart ? new Date(String(body.weekStart)) : null;

  if (!locationId || !weekStart || isNaN(weekStart.getTime())) {
    return NextResponse.json({ error: "locationId and weekStart are required" }, { status: 400 });
  }

  if (user.role === "MANAGER") {
    const allowed = await prisma.certification.findFirst({
      where: { userId: user.id, locationId },
    });
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000);

  if (action === "publish") {
    const result = await prisma.shift.updateMany({
      where: {
        locationId,
        startsAt: { gte: weekStart, lt: weekEnd },
        published: false,
      },
      data: { published: true },
    });

    const publishedShifts = await prisma.shift.findMany({
      where: {
        locationId,
        startsAt: { gte: weekStart, lt: weekEnd },
        published: true,
      },
      include: { assignments: true },
    });

    const notifyUserIds = new Set<string>();
    for (const shift of publishedShifts) {
      for (const a of shift.assignments) notifyUserIds.add(a.userId);
    }

    if (notifyUserIds.size) {
      const weekLabel = weekStart.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
      await notify(
        Array.from(notifyUserIds).map((uid) => ({
          userId: uid,
          title: "Week schedule published",
          body: `The schedule for the week of ${weekLabel} has been published. Check your assigned shifts.`,
        })),
      );
    }

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "WEEK_PUBLISHED",
        after: { locationId, weekStart, count: result.count },
      },
    });

    broadcast("shift_update", { locationId, weekStart: weekStart.toISOString(), action: "week_published" });
    return NextResponse.json({ published: result.count });
  }

  if (action === "unpublish") {
    const now = Date.now();
    const shifts = await prisma.shift.findMany({
      where: {
        locationId,
        startsAt: { gte: weekStart, lt: weekEnd },
        published: true,
      },
    });

    const eligible = shifts.filter(
      (s) => (s.startsAt.getTime() - now) / 3600000 >= CUTOFF_HOURS,
    );

    if (eligible.length === 0) {
      return NextResponse.json(
        { error: "No shifts can be unpublished (all are within the 48-hour cutoff)" },
        { status: 400 },
      );
    }

    const result = await prisma.shift.updateMany({
      where: { id: { in: eligible.map((s) => s.id) } },
      data: { published: false },
    });

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "WEEK_UNPUBLISHED",
        after: { locationId, weekStart, count: result.count },
      },
    });

    broadcast("shift_update", { locationId, weekStart: weekStart.toISOString(), action: "week_unpublished" });
    const skipped = shifts.length - eligible.length;
    return NextResponse.json({ unpublished: result.count, skipped });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
