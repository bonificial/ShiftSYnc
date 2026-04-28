import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { shiftLabel } from "@/lib/shiftLabel";
import { broadcast } from "@/lib/broadcast";
import { notify } from "@/lib/notify";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user || user.role !== "STAFF") {
    return NextResponse.json({ error: "Only staff can claim shifts" }, { status: 403 });
  }
  const { id } = await context.params;

  const swap = await prisma.swapRequest.findUnique({
    where: { id },
    include: { shift: true },
  });
  if (!swap) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (swap.type !== "DROP") return NextResponse.json({ error: "Can only claim drop requests" }, { status: 400 });
  if (swap.status !== "PENDING_MANAGER_APPROVAL") {
    return NextResponse.json({ error: "This shift is no longer available" }, { status: 400 });
  }
  if (swap.targetUserId) {
    return NextResponse.json({ error: "Already claimed by another staff member" }, { status: 409 });
  }
  if (swap.requesterId === user.id) {
    return NextResponse.json({ error: "Cannot claim your own drop request" }, { status: 400 });
  }

  const [myCerts, mySkills, myAssignments] = await Promise.all([
    prisma.certification.findFirst({ where: { userId: user.id, locationId: swap.shift.locationId } }),
    prisma.userSkill.findFirst({ where: { userId: user.id, skill: swap.shift.requiredSkill } }),
    prisma.shiftAssignment.findMany({ where: { userId: user.id }, include: { shift: true } }),
  ]);

  if (!myCerts) return NextResponse.json({ reason: "Not certified for this location" }, { status: 422 });
  if (!mySkills) return NextResponse.json({ reason: "Missing required skill" }, { status: 422 });

  for (const a of myAssignments) {
    const e = a.shift;
    const s = swap.shift;
    if (s.startsAt < e.endsAt && e.startsAt < s.endsAt) {
      return NextResponse.json({ reason: "Shift overlaps with an existing assignment" }, { status: 422 });
    }
    const gapBefore = (s.startsAt.getTime() - e.endsAt.getTime()) / 3600000;
    const gapAfter = (e.startsAt.getTime() - s.endsAt.getTime()) / 3600000;
    if ((gapBefore > 0 && gapBefore < 10) || (gapAfter > 0 && gapAfter < 10)) {
      return NextResponse.json({ reason: "Violates 10-hour rest rule" }, { status: 422 });
    }
  }

  const label = shiftLabel(swap.shift.seqId, swap.shift.startsAt, swap.shift.endsAt);

  const updated = await prisma.swapRequest.update({
    where: { id: swap.id },
    data: { targetUserId: user.id },
  });

  await Promise.all([
    prisma.auditLog.create({
      data: { actorId: user.id, action: "SHIFT_CLAIMED", after: { swapId: swap.id, label } },
    }),
    notify({
      userId: swap.requesterId,
      title: "Someone wants to pick up your dropped shift",
      body: `${user.name} has claimed ${label}. Awaiting manager approval.`,
    }),
  ]);

  broadcast("swap_update", { swapId: swap.id, action: "claimed" });
  return NextResponse.json({ swap: updated });
}
