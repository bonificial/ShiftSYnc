import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const GET = withAuth(["ADMIN", "MANAGER"], async () => {
  const staff = await prisma.user.findMany({
    where: { role: "STAFF" },
    include: { assignments: { include: { shift: true } } },
  });
  const overtime = staff.map((u) => {
    const total = u.assignments.reduce(
      (acc, row) => acc + (row.shift.endsAt.getTime() - row.shift.startsAt.getTime()) / 3600000,
      0,
    );
    return {
      userId: u.id,
      name: u.name,
      totalHours: Math.round(total * 10) / 10,
      warning: total >= 35,
      overLimit: total > 40,
    };
  });

  const shifts = await prisma.shift.findMany({ include: { assignments: true } });
  const premiumShiftIds = shifts
    .filter((s) => {
      const day = s.startsAt.getUTCDay();
      const hour = s.startsAt.getUTCHours();
      return [5, 6].includes(day) && hour >= 17;
    })
    .map((s) => s.id);
  const premiumByStaff = staff.map((u) => ({
    userId: u.id,
    name: u.name,
    premiumShifts: shifts.filter(
      (s) => premiumShiftIds.includes(s.id) && s.assignments.some((a) => a.userId === u.id),
    ).length,
  }));

  return NextResponse.json({
    overtime,
    fairness: premiumByStaff,
  });
});
