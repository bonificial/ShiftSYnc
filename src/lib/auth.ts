import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { Role } from "@/lib/types";
import { prisma } from "@/lib/prisma";

const SESSION_COOKIE = "shiftsync_session";

export async function currentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  return session?.user ?? null;
}

export function withAuth(
  allowedRoles: Role[],
  handler: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<Response>,
) {
  return async () => {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!allowedRoles.includes(user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return handler(user);
  };
}

export function setSession(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return;
  await prisma.session.deleteMany({ where: { token } });
}
