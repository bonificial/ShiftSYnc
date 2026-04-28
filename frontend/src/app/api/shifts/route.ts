import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Skill } from "@/lib/types";

export const GET = withAuth(["ADMIN", "MANAGER", "STAFF"], async (user) => {
  const locationIds =
    user.role === "MANAGER"
      ? (
          await prisma.certification.findMany({
            where: { userId: user.id },
            select: { locationId: true },
          })
        ).map((c) => c.locationId)
      : [];

  const shifts = await prisma.shift.findMany({
    where:
      user.role === "STAFF"
        ? { assignments: { some: { userId: user.id } } }
        : user.role === "MANAGER"
          ? { locationId: { in: locationIds } }
          : {},
    include: { assignments: true },
    orderBy: { startsAt: "asc" },
  });
  return NextResponse.json({ shifts });
});

export async function POST(request: NextRequest) {
  const body = await request.json();
  const user = await currentUser();
  if (!user || !["ADMIN", "MANAGER"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const locationId = String(body.locationId);
  if (user.role === "MANAGER") {
    const allowed = await prisma.certification.findFirst({
      where: { userId: user.id, locationId },
    });
    if (!allowed) {
      return NextResponse.json({ error: "Cannot manage this location" }, { status: 403 });
    }
  }

  const shift = await prisma.shift.create({
    data: {
      id: randomUUID(),
      locationId,
      requiredSkill: body.requiredSkill as Skill,
      headcountNeeded: Number(body.headcountNeeded ?? 1),
      startsAt: new Date(String(body.startsAt)),
      endsAt: new Date(String(body.endsAt)),
      published: false,
      createdBy: user.id,
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "SHIFT_CREATED",
      after: shift,
    },
  });
  return NextResponse.json({
    shift: {
      ...shift,
      assigneeIds: [],
    },
  });
}
