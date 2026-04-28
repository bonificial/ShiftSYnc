import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { shiftLabel } from "@/lib/shiftLabel";
import { broadcast } from "@/lib/broadcast";
import { notify } from "@/lib/notify";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user || !["ADMIN", "MANAGER"].includes(user.role)) {
    return NextResponse.json({ error: "Only managers/admins can approve swaps" }, { status: 403 });
  }
  const { id } = await context.params;
  const swap = await prisma.swapRequest.findUnique({ where: { id } });
  if (!swap) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (swap.status !== "PENDING_MANAGER_APPROVAL") {
    return NextResponse.json({ error: "Swap is not ready for manager approval" }, { status: 400 });
  }
  const shift = await prisma.shift.findUnique({ where: { id: swap.shiftId } });
  if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  if (user.role === "MANAGER") {
    const allowed = await prisma.certification.findFirst({
      where: { userId: user.id, locationId: shift.locationId },
    });
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const label = shiftLabel(shift.seqId, shift.startsAt, shift.endsAt);
  const body = await request.json().catch(() => ({}));

  if (body.reject) {
    const rejected = await prisma.swapRequest.update({ where: { id: swap.id }, data: { status: "REJECTED" } });
    await Promise.all([
      notify(
        [swap.requesterId, ...(swap.targetUserId ? [swap.targetUserId] : [])].map((uid) => ({
          userId: uid,
          title: "Swap request rejected",
          body: `Your swap/drop request for ${label} was rejected by ${user.name}.`,
        })),
      ),
      prisma.auditLog.create({
        data: { actorId: user.id, action: "SWAP_REJECTED", after: { swapId: swap.id, label } },
      }),
    ]);
    return NextResponse.json({ swap: rejected });
  }

  const existingAssignments = await prisma.shiftAssignment.findMany({ where: { shiftId: shift.id } });
  let updatedAssignmentUserIds = existingAssignments.map((a) => a.userId);

  if (swap.type === "DROP") {
    await prisma.shiftAssignment.deleteMany({ where: { shiftId: shift.id, userId: swap.requesterId } });
    updatedAssignmentUserIds = updatedAssignmentUserIds.filter((uid) => uid !== swap.requesterId);
  } else {
    if (!swap.targetUserId) return NextResponse.json({ error: "No target user on swap" }, { status: 400 });
    await prisma.shiftAssignment.deleteMany({ where: { shiftId: shift.id, userId: swap.requesterId } });
    await prisma.shiftAssignment.create({ data: { shiftId: shift.id, userId: swap.targetUserId } });
    updatedAssignmentUserIds = updatedAssignmentUserIds
      .filter((uid) => uid !== swap.requesterId)
      .concat(swap.targetUserId);
  }

  const approved = await prisma.swapRequest.update({ where: { id: swap.id }, data: { status: "APPROVED" } });

  await Promise.all([
    notify(
      [swap.requesterId, ...(swap.targetUserId ? [swap.targetUserId] : [])].map((uid) => ({
        userId: uid,
        title: swap.type === "DROP" ? "Drop request approved" : "Swap request approved",
        body:
          swap.type === "DROP"
            ? `Your drop request for ${label} was approved by ${user.name}.`
            : `Your swap for ${label} was approved by ${user.name}.`,
      })),
    ),
    prisma.auditLog.create({
      data: { actorId: user.id, action: "SWAP_APPROVED", after: { swapId: swap.id, label } },
    }),
  ]);

  broadcast("swap_update", { swapId: swap.id, action: "approved" });
  broadcast("shift_update", { shiftId: shift.id, action: "swap_approved" });
  return NextResponse.json({ swap: approved, shift: { ...shift, assigneeIds: updatedAssignmentUserIds } });
}
