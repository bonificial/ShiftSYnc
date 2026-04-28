import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cancelSwapsForShift } from "@/lib/expiry";
import { broadcast } from "@/lib/broadcast";
import { Skill } from "@prisma/client";

export async function PATCH(
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

  if (user.role === "MANAGER") {
    const allowed = await prisma.certification.findFirst({
      where: { userId: user.id, locationId: shift.locationId },
    });
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const data: {
    startsAt?: Date;
    endsAt?: Date;
    requiredSkill?: Skill;
    headcountNeeded?: number;
  } = {};

  if (body.startsAt) data.startsAt = new Date(String(body.startsAt));
  if (body.endsAt) data.endsAt = new Date(String(body.endsAt));
  if (body.requiredSkill) data.requiredSkill = body.requiredSkill as Skill;
  if (body.headcountNeeded != null) data.headcountNeeded = Number(body.headcountNeeded);

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const [updated] = await Promise.all([
    prisma.shift.update({ where: { id }, data }),
    cancelSwapsForShift(prisma, id, user.name),
    prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "SHIFT_EDITED",
        before: JSON.parse(JSON.stringify({ shiftId: id, locationId: shift.locationId, startsAt: shift.startsAt, endsAt: shift.endsAt, requiredSkill: shift.requiredSkill, headcountNeeded: shift.headcountNeeded })),
        after: JSON.parse(JSON.stringify({ shiftId: id, locationId: shift.locationId, ...data })),
      },
    }),
  ]);

  broadcast("shift_update", { shiftId: id, action: "edited" });
  return NextResponse.json({ shift: updated });
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const [user, { id }] = await Promise.all([currentUser(), context.params]);

  if (!user || !["ADMIN", "MANAGER"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shift = await prisma.shift.findUnique({ where: { id } });
  if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });

  if (user.role === "MANAGER") {
    const allowed = await prisma.certification.findFirst({
      where: { userId: user.id, locationId: shift.locationId },
    });
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await cancelSwapsForShift(prisma, id, user.name);
  await prisma.shift.delete({ where: { id } });
  await prisma.auditLog.create({
    data: { actorId: user.id, action: "SHIFT_DELETED", after: JSON.parse(JSON.stringify({ shiftId: id, locationId: shift.locationId, startsAt: shift.startsAt, endsAt: shift.endsAt, requiredSkill: shift.requiredSkill })) },
  });
  broadcast("shift_update", { shiftId: id, action: "deleted" });
  return NextResponse.json({ success: true });
}
