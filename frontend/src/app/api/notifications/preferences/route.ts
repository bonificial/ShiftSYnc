import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const fresh = await prisma.user.findUnique({
    where: { id: user.id },
    select: { notifPref: true, email: true },
  });
  return NextResponse.json({ notifPref: fresh?.notifPref ?? "IN_APP", email: fresh?.email });
}

export async function PUT(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const pref = body.notifPref === "IN_APP_EMAIL" ? "IN_APP_EMAIL" : "IN_APP";

  await prisma.user.update({
    where: { id: user.id },
    data: { notifPref: pref },
  });

  return NextResponse.json({ notifPref: pref });
}
