import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { broadcast } from "@/lib/broadcast";

const CUTOFF_HOURS = 48;

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user || !["ADMIN", "MANAGER"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;

  const shift = await prisma.shift.findUnique({ where: { id } });
  if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });

  if (user.role === "MANAGER") {
    const allowed = await prisma.certification.findFirst({
      where: { userId: user.id, locationId: shift.locationId },
    });
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const hoursUntilShift = (shift.startsAt.getTime() - Date.now()) / 3600000;
  if (hoursUntilShift < CUTOFF_HOURS) {
    return NextResponse.json(
      { error: `Cannot unpublish a shift within ${CUTOFF_HOURS} hours of its start time` },
      { status: 400 },
    );
  }

  const updated = await prisma.shift.update({ where: { id }, data: { published: false } });

  await prisma.auditLog.create({
    data: { actorId: user.id, action: "SHIFT_UNPUBLISHED", after: JSON.parse(JSON.stringify({ shiftId: id, locationId: shift.locationId, startsAt: shift.startsAt })) },
  });

  broadcast("shift_update", { shiftId: id, action: "unpublished" });
  return NextResponse.json({ shift: updated });
}
