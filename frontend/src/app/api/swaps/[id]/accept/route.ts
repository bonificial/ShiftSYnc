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
  if (!user || user.role !== "STAFF") {
    return NextResponse.json({ error: "Only staff can accept swaps" }, { status: 403 });
  }
  const { id } = await context.params;
  const swap = await prisma.swapRequest.findUnique({
    where: { id },
    include: { shift: true, requester: { select: { name: true } } },
  });
  if (!swap) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (swap.status !== "PENDING_PARTY_ACCEPTANCE") {
    return NextResponse.json({ error: "Swap is not awaiting acceptance" }, { status: 400 });
  }
  if (swap.targetUserId && swap.targetUserId !== user.id) {
    return NextResponse.json({ error: "This swap is not targeted at you" }, { status: 403 });
  }

  const updated = await prisma.swapRequest.update({
    where: { id: swap.id },
    data: { targetUserId: user.id, status: "PENDING_MANAGER_APPROVAL" },
  });

  const shiftTime = shiftLabel(swap.shift.seqId, swap.shift.startsAt, swap.shift.endsAt);

  const managers = await prisma.certification.findMany({
    where: { locationId: swap.shift.locationId },
    include: { user: { select: { id: true, role: true } } },
  });

  const managerNotifs = managers
    .filter((c) => c.user.role === "MANAGER" || c.user.role === "ADMIN")
    .map((c) => ({
      userId: c.user.id,
      title: "Swap request awaiting your approval",
      body: `${swap.requester.name} → ${user.name} swap on ${shiftTime} is ready for your approval.`,
    }));

  await Promise.all([
    notify([
      {
        userId: swap.requesterId,
        title: "Colleague accepted your swap",
        body: `${user.name} accepted your swap request for ${shiftTime}. Awaiting manager approval.`,
      },
      ...managerNotifs,
    ]),
    prisma.auditLog.create({
      data: { actorId: user.id, action: "SWAP_ACCEPTED", after: { swapId: swap.id } },
    }),
  ]);

  broadcast("swap_update", { swapId: swap.id, action: "accepted" });
  return NextResponse.json({ swap: updated });
}
