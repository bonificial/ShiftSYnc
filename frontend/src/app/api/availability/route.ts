import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prismaWithOptional = prisma as unknown as {
    availabilityWindow: typeof prisma.availabilityWindow;
    availabilityException?: {
      findMany: (args: { where: { userId: string }; orderBy: { date: "asc" | "desc" } }) => Promise<
        Array<{
          id: string;
          date: Date;
          isOff: boolean;
          startHour: number | null;
          endHour: number | null;
          userId: string;
        }>
      >;
    };
  };

  const [weekly, exceptions] = await Promise.all([
    prismaWithOptional.availabilityWindow.findMany({
      where: { userId: user.id },
      orderBy: { dayOfWeek: "asc" },
    }),
    prismaWithOptional.availabilityException
      ? prismaWithOptional.availabilityException.findMany({
          where: { userId: user.id },
          orderBy: { date: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return NextResponse.json(
    { weekly, exceptions },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    },
  );
}

export async function PUT(request: NextRequest) {
  const user = await currentUser();
  if (!user || user.role !== "STAFF") {
    return NextResponse.json({ error: "Only staff can edit availability" }, { status: 403 });
  }

  const body = await request.json();
  const weekly: Array<{ dayOfWeek: number; startHour: number; endHour: number }> = [];
  if (Array.isArray(body.weekly)) {
    for (const row of body.weekly as unknown[]) {
      if (
        typeof row === "object" &&
        row !== null &&
        "dayOfWeek" in row &&
        "startHour" in row &&
        "endHour" in row
      ) {
        const record = row as { dayOfWeek: unknown; startHour: unknown; endHour: unknown };
        weekly.push({
          dayOfWeek: Number(record.dayOfWeek),
          startHour: Number(record.startHour),
          endHour: Number(record.endHour),
        });
      }
    }
  }

  if (weekly.length !== 7) {
    return NextResponse.json(
      { error: "Weekly availability must include exactly 7 days (Sun-Sat)." },
      { status: 400 },
    );
  }

  const seenDays = new Set<number>();
  for (const row of weekly) {
    if (
      !Number.isInteger(row.dayOfWeek) ||
      !Number.isInteger(row.startHour) ||
      !Number.isInteger(row.endHour)
    ) {
      return NextResponse.json(
        { error: "Availability values must be whole numbers." },
        { status: 400 },
      );
    }
    if (row.dayOfWeek < 0 || row.dayOfWeek > 6) {
      return NextResponse.json({ error: `Invalid dayOfWeek: ${row.dayOfWeek}` }, { status: 400 });
    }
    if (row.startHour < 0 || row.startHour > 23 || row.endHour < 1 || row.endHour > 24) {
      return NextResponse.json(
        { error: `Invalid hour range for day ${row.dayOfWeek}.` },
        { status: 400 },
      );
    }
    if (row.startHour >= row.endHour) {
      return NextResponse.json(
        { error: `Start hour must be before end hour for day ${row.dayOfWeek}.` },
        { status: 400 },
      );
    }
    if (seenDays.has(row.dayOfWeek)) {
      return NextResponse.json(
        { error: `Duplicate day entry for day ${row.dayOfWeek}.` },
        { status: 400 },
      );
    }
    seenDays.add(row.dayOfWeek);
  }
  if (seenDays.size !== 7) {
    return NextResponse.json(
      { error: "All days from Sun(0) to Sat(6) must be present." },
      { status: 400 },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.availabilityWindow.deleteMany({ where: { userId: user.id } });
    await tx.availabilityWindow.createMany({
      data: weekly.map((row) => ({
        userId: user.id,
        dayOfWeek: row.dayOfWeek,
        startHour: row.startHour,
        endHour: row.endHour,
      })),
    });
  });

  const updated = await prisma.availabilityWindow.findMany({
    where: { userId: user.id },
    orderBy: { dayOfWeek: "asc" },
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "AVAILABILITY_WEEKLY_UPDATED",
      after: { count: updated.length },
    },
  });

  // Notify managers for this staff member's locations
  const certs = await prisma.certification.findMany({
    where: { userId: user.id },
    select: { locationId: true },
  });
  const locationIds = certs.map((c) => c.locationId);
  if (locationIds.length) {
    const managerCerts = await prisma.certification.findMany({
      where: { locationId: { in: locationIds } },
      include: { user: { select: { id: true, role: true } } },
    });
    const mgrs = managerCerts.filter(
      (c) => (c.user.role === "MANAGER" || c.user.role === "ADMIN") && c.user.id !== user.id,
    );
    const uniqueMgrs = [...new Map(mgrs.map((c) => [c.user.id, c.user])).values()];
    if (uniqueMgrs.length) {
      await notify(
        uniqueMgrs.map((m) => ({
          userId: m.id,
          title: "Staff availability updated",
          body: `${user.name} updated their weekly availability windows.`,
        })),
      );
    }
  }

  return NextResponse.json({ weekly: updated });
}
