import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { expireStaleDrops } from "@/lib/expiry";

export async function GET() {
  const user = await currentUser();
  if (!user || user.role !== "STAFF") {
    return NextResponse.json({ error: "Only staff can view available shifts" }, { status: 403 });
  }

  await expireStaleDrops(prisma);

  const [myCertifications, mySkills, myAssignments, openDropRequests] = await Promise.all([
    prisma.certification.findMany({ where: { userId: user.id }, select: { locationId: true } }),
    prisma.userSkill.findMany({ where: { userId: user.id }, select: { skill: true } }),
    prisma.shiftAssignment.findMany({ where: { userId: user.id }, include: { shift: true } }),
    prisma.swapRequest.findMany({
      where: { type: "DROP", status: "PENDING_MANAGER_APPROVAL", targetUserId: null },
      include: {
        shift: true,
        requester: { select: { name: true } },
      },
    }),
  ]);

  const myCertSet = new Set(myCertifications.map((c) => c.locationId));
  const mySkillSet = new Set(mySkills.map((s) => s.skill));
  const myShiftIds = new Set(myAssignments.map((a) => a.shiftId));

  const available = openDropRequests.filter((req) => {
    if (req.requesterId === user.id) return false;
    const shift = req.shift;
    if (myShiftIds.has(shift.id)) return false;
    if (!myCertSet.has(shift.locationId)) return false;
    if (!mySkillSet.has(shift.requiredSkill)) return false;
    for (const a of myAssignments) {
      const e = a.shift;
      if (shift.startsAt < e.endsAt && e.startsAt < shift.endsAt) return false;
      const gapBefore = (shift.startsAt.getTime() - e.endsAt.getTime()) / 3600000;
      const gapAfter = (e.startsAt.getTime() - shift.endsAt.getTime()) / 3600000;
      if ((gapBefore > 0 && gapBefore < 10) || (gapAfter > 0 && gapAfter < 10)) return false;
    }
    return true;
  });

  return NextResponse.json(
    {
      available: available.map((req) => ({
        swapRequestId: req.id,
        shiftId: req.shift.id,
        locationId: req.shift.locationId,
        requiredSkill: req.shift.requiredSkill,
        startsAt: req.shift.startsAt,
        endsAt: req.shift.endsAt,
        requesterName: req.requester.name,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
