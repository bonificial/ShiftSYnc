import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 25;

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user || user.role === "STAFF") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : undefined;
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : undefined;
  const locationId = searchParams.get("locationId") ?? undefined;
  const page = Math.max(0, Number(searchParams.get("page") ?? 0));

  // Managers can only see logs from their certified locations
  let allowedLocationIds: string[] | undefined;
  if (user.role === "MANAGER") {
    const certs = await prisma.certification.findMany({
      where: { userId: user.id },
      select: { locationId: true },
    });
    allowedLocationIds = certs.map((c) => c.locationId);
    if (allowedLocationIds.length === 0) {
      return NextResponse.json({ logs: [], total: 0 });
    }
  }

  // Build a date-range filter on createdAt
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (from) createdAt.gte = from;
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    createdAt.lte = end;
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: { ...(Object.keys(createdAt).length ? { createdAt } : {}) },
      include: { actor: { select: { name: true, role: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: page * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({
      where: { ...(Object.keys(createdAt).length ? { createdAt } : {}) },
    }),
  ]);

  // Filter in JS by location (JSON field `after.locationId`)
  const filterByLocation = (entry: (typeof logs)[0]) => {
    const after = entry.after as Record<string, unknown> | null;
    const before = entry.before as Record<string, unknown> | null;
    const loc = after?.locationId ?? before?.locationId;

    if (locationId && loc !== locationId) return false;
    if (allowedLocationIds && loc && !allowedLocationIds.includes(String(loc))) return false;
    return true;
  };

  const filtered = logs.filter(filterByLocation);

  return NextResponse.json({
    logs: filtered.map((l) => ({
      id: l.id,
      createdAt: l.createdAt,
      action: l.action,
      actorName: l.actor.name,
      actorRole: l.actor.role,
      actorEmail: l.actor.email,
      before: l.before,
      after: l.after,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  });
}
