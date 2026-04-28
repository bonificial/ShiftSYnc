import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const managerLocationIds =
    user.role === "MANAGER"
      ? (
          await prisma.certification.findMany({
            where: { userId: user.id },
            select: { locationId: true },
          })
        ).map((c) => c.locationId)
      : [];

  const staff = await prisma.user.findMany({
    where: { role: "STAFF" },
    include: {
      certifications: { select: { locationId: true } },
      skills: { select: { skill: true } },
    },
    orderBy: { name: "asc" },
  });

  const scopedStaff =
    user.role === "ADMIN" || user.role === "STAFF"
      ? staff
      : staff.filter((s) =>
          s.certifications.some((cert) => managerLocationIds.includes(cert.locationId)),
        );

  return NextResponse.json({
    staff: scopedStaff.map((s) => ({
      id: s.id,
      name: s.name,
      certifications: s.certifications.map((c) => c.locationId),
      skills: s.skills.map((k) => k.skill),
    })),
  });
}
