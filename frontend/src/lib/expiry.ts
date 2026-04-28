import { PrismaClient } from "@prisma/client";
import { shiftLabel } from "@/lib/shiftLabel";
import { notify } from "@/lib/notify";

export async function expireStaleDrops(prisma: PrismaClient): Promise<number> {
  try {
    const now = Date.now();

    // Find unclaimed DROP requests where the shift is within 24 h AND the request
    // was created BEFORE the shift entered the 24-hour window.  This lets emergency
    // same-day drops (e.g. "6pm drop for a 7pm shift") remain visible so someone
    // can still claim them — we only auto-expire requests that already had >24 h
    // to find coverage and didn't.
    const stale = await prisma.swapRequest.findMany({
      where: {
        type: "DROP",
        status: "PENDING_MANAGER_APPROVAL",
        targetUserId: null,
        shift: { startsAt: { lt: new Date(now + 24 * 3600 * 1000) } },
        // Created before the 24-hour window opened (i.e. a stale request, not new)
        createdAt: { lt: new Date(now - 60 * 1000) }, // at least 1 min old guard
      },
      include: { shift: { select: { id: true, seqId: true, startsAt: true, endsAt: true } } },
    });

    // Further filter: only expire if the drop was submitted before T-24h mark
    const trulyStale = stale.filter((s) => {
      const windowOpened = s.shift.startsAt.getTime() - 24 * 3600 * 1000;
      return s.createdAt.getTime() < windowOpened;
    });

    if (trulyStale.length === 0) return 0;

    await prisma.swapRequest.updateMany({
      where: { id: { in: trulyStale.map((s) => s.id) } },
      data: { status: "EXPIRED" },
    });

    await notify(
      trulyStale.map((s) => ({
        userId: s.requesterId,
        title: "Drop request expired",
        body: `Your drop request for ${shiftLabel(s.shift.seqId, s.shift.startsAt, s.shift.endsAt)} expired — no one claimed it within 24 hours of the shift.`,
      })),
    );

    return trulyStale.length;
  } catch {
    // seqId column not yet migrated — skip silently
    return 0;
  }
}

export async function cancelSwapsForShift(
  prisma: PrismaClient,
  shiftId: string,
  actorName: string,
): Promise<void> {
  const active = await prisma.swapRequest.findMany({
    where: {
      shiftId,
      status: { in: ["PENDING_PARTY_ACCEPTANCE", "PENDING_MANAGER_APPROVAL"] },
    },
  });

  if (active.length === 0) return;

  await prisma.swapRequest.updateMany({
    where: { id: { in: active.map((s) => s.id) } },
    data: { status: "CANCELLED" },
  });

  const userIds = new Set<string>();
  for (const sw of active) {
    userIds.add(sw.requesterId);
    if (sw.targetUserId) userIds.add(sw.targetUserId);
  }

  await notify(
    Array.from(userIds).map((uid) => ({
      userId: uid,
      title: "Swap/drop request cancelled",
      body: `Your swap or drop request was automatically cancelled because ${actorName} edited the associated shift.`,
    })),
  );
}
