import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user || user.role !== "STAFF") {
    return NextResponse.json({ error: "Only staff can delete exceptions" }, { status: 403 });
  }
  const prismaWithOptional = prisma as unknown as {
    availabilityException?: {
      findFirst: (args: { where: { id: string; userId: string } }) => Promise<unknown>;
      delete: (args: { where: { id: string } }) => Promise<unknown>;
    };
  };
  if (!prismaWithOptional.availabilityException) {
    return NextResponse.json(
      { error: "Availability exceptions are unavailable. Run `npm run db:generate` and restart dev server." },
      { status: 503 },
    );
  }
  const { id } = await context.params;
  const target = await prismaWithOptional.availabilityException.findFirst({
    where: { id, userId: user.id },
  });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prismaWithOptional.availabilityException.delete({ where: { id } });
  await prisma.auditLog.create({
    data: { actorId: user.id, action: "AVAILABILITY_EXCEPTION_DELETED", before: target },
  });
  return NextResponse.json({ ok: true });
}
