import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const notification = await prisma.notification.findFirst({
    where: { id, userId: user.id },
  });
  if (!notification) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const updated = await prisma.notification.update({
    where: { id: notification.id },
    data: { read: true },
  });
  return NextResponse.json({ notification: updated });
}
