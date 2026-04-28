import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";

export async function POST() {
  await clearSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set("shiftsync_session", "", { maxAge: 0, path: "/" });
  return response;
}
