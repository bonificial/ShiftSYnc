import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { shiftLabel } from "@/lib/shiftLabel";
import { broadcast } from "@/lib/broadcast";
import { notify } from "@/lib/notify";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user || !["ADMIN", "MANAGER"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const shift = await prisma.shift.findUnique({
    where: { id },
    include: { assignments: true },
  });
  if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  if (user.role === "MANAGER") {
    const allowed = await prisma.certification.findFirst({
      where: { userId: user.id, locationId: shift.locationId },
    });
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const label = shiftLabel(shift.seqId, shift.startsAt, shift.endsAt);
  const updated = await prisma.shift.update({ where: { id: shift.id }, data: { published: true } });

  if (shift.assignments.length) {
    await notify(
      shift.assignments.map((a) => ({
        userId: a.userId,
        title: "Schedule published",
        body: `${label} is now published and visible on your schedule.`,
      })),
    );
  }
  await prisma.auditLog.create({
    data: { actorId: user.id, action: "SHIFT_PUBLISHED", after: { shiftId: shift.id, locationId: shift.locationId, label } },
  });
  broadcast("shift_update", { shiftId: shift.id, action: "published" });
  return NextResponse.json({ shift: updated });
}
