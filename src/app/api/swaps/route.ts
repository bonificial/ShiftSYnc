import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { shiftLabel } from "@/lib/shiftLabel";
import { broadcast } from "@/lib/broadcast";
import { notify } from "@/lib/notify";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const swaps = await prisma.swapRequest.findMany({
    where:
      user.role === "STAFF"
        ? { OR: [{ requesterId: user.id }, { targetUserId: user.id }] }
        : {},
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ swaps });
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user || user.role !== "STAFF") {
    return NextResponse.json({ error: "Only staff can create requests" }, { status: 403 });
  }

  const [pendingCount, body] = await Promise.all([
    prisma.swapRequest.count({
      where: {
        requesterId: user.id,
        status: { in: ["PENDING_PARTY_ACCEPTANCE", "PENDING_MANAGER_APPROVAL"] },
      },
    }),
    request.json(),
  ]);

  if (pendingCount >= 3) {
    return NextResponse.json({ error: "You already have 3 pending swap/drop requests" }, { status: 400 });
  }

  const shiftId = String(body.shiftId ?? "");
  const type = body.type === "DROP" ? "DROP" : "SWAP";
  const targetUserId = body.targetUserId ? String(body.targetUserId) : undefined;

  if (type === "SWAP" && !targetUserId) {
    return NextResponse.json(
      { error: "A SWAP request requires selecting a specific colleague to swap with." },
      { status: 400 },
    );
  }

  const [shift, targetUser] = await Promise.all([
    prisma.shift.findFirst({
      where: { id: shiftId, assignments: { some: { userId: user.id } } },
    }),
    targetUserId ? prisma.user.findUnique({ where: { id: targetUserId } }) : Promise.resolve(null),
  ]);

  if (!shift) return NextResponse.json({ error: "Shift not found or not assigned to you" }, { status: 404 });
  if (targetUserId && !targetUser) return NextResponse.json({ error: "Target staff member not found" }, { status: 404 });

  const swap = await prisma.swapRequest.create({
    data: {
      shiftId,
      requesterId: user.id,
      targetUserId,
      type,
      status: type === "DROP" ? "PENDING_MANAGER_APPROVAL" : "PENDING_PARTY_ACCEPTANCE",
    },
  });

  const shiftTime = shiftLabel(shift.seqId, shift.startsAt, shift.endsAt);

  const notifications: { userId: string; title: string; body: string }[] = [];

  if (type === "DROP") {
    // Notify managers so they are aware a drop is up for grabs
    const managers = await prisma.certification.findMany({
      where: { locationId: shift.locationId },
      include: { user: { select: { id: true, role: true } } },
    });
    for (const c of managers) {
      if (c.user.role === "MANAGER" || c.user.role === "ADMIN") {
        notifications.push({
          userId: c.user.id,
          title: "Staff drop request submitted",
          body: `${user.name} dropped a shift on ${shiftTime}. Awaiting another staff to claim it.`,
        });
      }
    }
  } else if (targetUser) {
    notifications.push({
      userId: targetUser.id,
      title: "Swap request from a colleague",
      body: `${user.name} wants to swap their ${shiftTime} shift with you. Please accept or ignore.`,
    });
  }

  await Promise.all([
    notifications.length ? notify(notifications) : Promise.resolve(),
    prisma.auditLog.create({
      data: { actorId: user.id, action: "SWAP_CREATED", after: { swapId: swap.id, type, shiftId, locationId: shift.locationId } },
    }),
  ]);

  broadcast("swap_update", { swapId: swap.id, action: "created", type });
  return NextResponse.json({ swap });
}
