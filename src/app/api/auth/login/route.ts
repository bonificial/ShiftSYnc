import { NextRequest, NextResponse } from "next/server";
import { setSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const email = String(body.email ?? "").toLowerCase();
  const password = String(body.password ?? "");
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, password },
  });

  if (!user) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = randomUUID();
  await prisma.session.create({
    data: { token, userId: user.id },
  });
  const response = NextResponse.json({
    user: { id: user.id, name: user.name, role: user.role, email: user.email },
  });
  setSession(response, token);
  return response;
}
