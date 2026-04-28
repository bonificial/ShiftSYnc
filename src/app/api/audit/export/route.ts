import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const LOCATION_NAMES: Record<string, string> = {
  "l-east": "Harbor View",
  "l-west": "Pier Grill",
};

function escapeCSV(val: unknown): string {
  if (val == null) return "";
  const s = String(val).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}

function jsonSummary(obj: unknown): string {
  if (!obj || typeof obj !== "object") return "";
  const entries = Object.entries(obj as Record<string, unknown>)
    .filter(([k]) => k !== "locationId") // redundant — shown in own column
    .map(([k, v]) => {
      const val = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
      return `${k}: ${val}`;
    });
  return entries.join(" | ");
}

function humanAction(action: string): string {
  return action
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : undefined;
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : undefined;
  const locationId = searchParams.get("locationId") ?? undefined;

  const createdAt: { gte?: Date; lte?: Date } = {};
  if (from) createdAt.gte = from;
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    createdAt.lte = end;
  }

  const logs = await prisma.auditLog.findMany({
    where: { ...(Object.keys(createdAt).length ? { createdAt } : {}) },
    include: { actor: { select: { name: true, role: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  // Location filter (JSON field)
  const filtered = locationId
    ? logs.filter((l) => {
        const after = l.after as Record<string, unknown> | null;
        const before = l.before as Record<string, unknown> | null;
        return after?.locationId === locationId || before?.locationId === locationId;
      })
    : logs;

  const header = ["Timestamp", "Action", "Actor", "Role", "Email", "Location", "Before", "After"];

  const rows = filtered.map((l) => {
    const after = l.after as Record<string, unknown> | null;
    const before = l.before as Record<string, unknown> | null;
    const locId = String(after?.locationId ?? before?.locationId ?? "");
    const locName = LOCATION_NAMES[locId] ?? locId;

    return [
      l.createdAt.toISOString(),
      humanAction(l.action),
      l.actor.name,
      l.actor.role,
      l.actor.email,
      locName,
      jsonSummary(before),
      jsonSummary(after),
    ].map(escapeCSV);
  });

  const csv = [header, ...rows].map((r) => r.join(",")).join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="shiftsync-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
