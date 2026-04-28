import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { broadcast } from "@/lib/broadcast";
import { shiftLabel } from "@/lib/shiftLabel";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;

  const swap = await prisma.swapRequest.findUnique({
    where: { id },
    include: {
      shift: { select: { seqId: true, startsAt: true, endsAt: true } },
      requester: { select: { name: true } },
      targetUser: { select: { name: true } },
    },
  });

  if (!swap) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isRequester = swap.requesterId === user.id;
  const isTarget = swap.targetUserId === user.id;
  const isManagerOrAdmin = user.role === "MANAGER" || user.role === "ADMIN";

  if (!isRequester && !isTarget && !isManagerOrAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Only pending requests can be cancelled
  if (!["PENDING_PARTY_ACCEPTANCE", "PENDING_MANAGER_APPROVAL"].includes(swap.status)) {
    return NextResponse.json(
      { error: "Only pending requests can be cancelled" },
      { status: 400 },
    );
  }

  const updated = await prisma.swapRequest.update({
    where: { id: swap.id },
    data: { status: "CANCELLED" },
  });

  const label = shiftLabel(swap.shift.seqId, swap.shift.startsAt, swap.shift.endsAt);

  // Notify all parties
  const notifyIds = new Set<string>([swap.requesterId]);
  if (swap.targetUserId) notifyIds.add(swap.targetUserId);

  const withdrawerName = isRequester
    ? swap.requester.name
    : isTarget
      ? (swap.targetUser?.name ?? user.name)
      : user.name;

  await Promise.all([
    notify(
      Array.from(notifyIds)
        .filter((uid) => uid !== user.id)
        .map((uid) => ({
          userId: uid,
          title: "Swap/drop request cancelled",
          body: `${withdrawerName} withdrew the ${swap.type.toLowerCase()} request for ${label}.`,
        })),
    ),
    prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "SWAP_CANCELLED",
        after: { swapId: swap.id, type: swap.type, withdrawnBy: user.id },
      },
    }),
  ]);

  broadcast("swap_update", { swapId: swap.id, action: "cancelled" });
  return NextResponse.json({ swap: updated });
}
