"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

type User = { id: string; name: string; email: string; role: string; locations?: string[] };
type AuditEntry = {
  id: string; createdAt: string; action: string;
  actorName: string; actorRole: string;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null;
};

const LOCATION_LABELS: Record<string, string> = { "l-east": "Harbor View", "l-west": "Pier Grill" };
const PAGE_SIZE = 25;

export default function AuditPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState({ from: "", to: "", locationId: "" });
  const [isFetching, setIsFetching] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.user || !["MANAGER", "ADMIN"].includes(data.user.role)) {
          router.replace("/");
          return;
        }
        setUser(data.user);
        setLoading(false);
      })
      .catch(() => router.replace("/"));
  }, [router]);

  const load = useCallback(async (p: number, f = filter) => {
    setIsFetching(true);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (f.from) params.set("from", f.from);
      if (f.to) params.set("to", f.to);
      if (f.locationId) params.set("locationId", f.locationId);
      const res = await fetch(`/api/audit?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setLogs(data.logs ?? []);
      setTotal(data.total ?? 0);
      setPage(p);
    } finally {
      setIsFetching(false);
    }
  }, [filter]);

  useEffect(() => {
    if (!loading && user) void load(0);
  }, [loading, user]); // eslint-disable-line react-hooks/exhaustive-deps

  async function logout() {
    setIsLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.push("/");
  }

  function exportCsv() {
    const params = new URLSearchParams();
    if (filter.from) params.set("from", filter.from);
    if (filter.to) params.set("to", filter.to);
    if (filter.locationId) params.set("locationId", filter.locationId);
    window.open(`/api/audit/export?${params.toString()}`, "_blank");
  }

  function summarise(obj: Record<string, unknown>) {
    return Object.entries(obj)
      .filter(([k]) => !["locationId", "shiftId", "swapId"].includes(k))
      .map(([k, v]) => {
        if (Array.isArray(v)) return `${k}: [${(v as unknown[]).join(", ")}]`;
        return `${k}: ${String(v ?? "—")}`;
      })
      .join(" · ") || "—";
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cover bg-center"
        style={{ backgroundImage: "url('/nastuh-abootalebi-eHD8Y1Znfpk-unsplash.jpg')" }}>
        <div className="flex flex-col items-center gap-4">
          <div className="animate-[logoFloat_1.4s_ease-in-out_infinite]">
            <Image src="/logo.webp" alt="ShiftSync" width={120} height={120} priority style={{ height: "auto" }} />
          </div>
          <p className="text-sm text-white/80">Loading…</p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen p-5 md:p-8 bg-slate-50">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">

        {/* ── Sidebar ─────────────────────────────────────────────── */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-5 lg:self-start">

          {/* Brand + user card */}
          <div className="rounded-2xl bg-card p-4 shadow-sm flex items-center gap-4">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <Image src="/logo.webp" alt="ShiftSync" width={48} height={48} style={{ height: "auto" }} />
              <p className="text-xs uppercase tracking-wide text-muted leading-none">ShiftSync</p>
            </div>
            <div className="h-10 w-px bg-border shrink-0" />
            <div className="flex-1 text-right">
              <p className="text-xs uppercase tracking-wide text-muted">{user?.role} Console</p>
              <p className="mt-0.5 text-base font-semibold leading-tight">{user?.name}</p>
              <p className="mt-0.5 text-xs text-muted">
                {user?.locations?.join(", ") ?? user?.email}
              </p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="rounded-2xl bg-card p-3 shadow-sm flex flex-col gap-1">
            <a
              href="/"
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-slate-50 hover:text-foreground transition-colors"
            >
              <span className="text-base">⊞</span>
              Dashboard
            </a>
            <a
              href="/audit"
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium bg-primary/8 text-primary transition-colors"
              aria-current="page"
            >
              <span className="text-base">▤</span>
              Audit Trail
            </a>
          </nav>

          {/* Logout */}
          <button
            onClick={logout}
            disabled={isLoggingOut}
            className="rounded-2xl border bg-card px-3 py-2.5 text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLoggingOut ? "Logging out…" : "Logout"}
          </button>
        </aside>

        {/* ── Main content ─────────────────────────────────────────── */}
        <main className="space-y-5">
          <header className="rounded-2xl bg-card p-5 shadow-sm">
            <h2 className="text-2xl font-semibold">Audit Trail</h2>
            <p className="mt-1 text-sm text-muted">All schedule changes — who, when, and what changed.</p>
          </header>

          <div className="rounded-2xl bg-card p-6 shadow-sm">
            {/* Filters */}
            <div className="flex flex-wrap items-end gap-3 border-b pb-5">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted">From</label>
                <input
                  type="date"
                  className="rounded-md border px-2 py-1.5 text-sm"
                  value={filter.from}
                  onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted">To</label>
                <input
                  type="date"
                  className="rounded-md border px-2 py-1.5 text-sm"
                  value={filter.to}
                  onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))}
                />
              </div>
              {user?.role === "ADMIN" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted">Location</label>
                  <select
                    className="rounded-md border px-2 py-1.5 text-sm"
                    value={filter.locationId}
                    onChange={(e) => setFilter((f) => ({ ...f, locationId: e.target.value }))}
                  >
                    <option value="">All locations</option>
                    {Object.entries(LOCATION_LABELS).map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex items-center gap-2 ml-auto">
                {user?.role === "ADMIN" && (
                  <button
                    onClick={exportCsv}
                    className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer"
                  >
                    Export CSV
                  </button>
                )}
                <button
                  onClick={() => void load(0, filter)}
                  disabled={isFetching}
                  className="rounded-md bg-primary px-4 py-1.5 text-sm text-white disabled:opacity-60 cursor-pointer"
                >
                  {isFetching ? "Loading…" : "Apply"}
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="mt-4">
              {logs.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  {isFetching ? "Loading entries…" : "No audit entries found for the selected filters."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b text-left text-muted">
                        <th className="pb-2 pr-4 font-medium">When</th>
                        <th className="pb-2 pr-4 font-medium">Action</th>
                        <th className="pb-2 pr-4 font-medium">By</th>
                        <th className="pb-2 pr-4 font-medium">Location</th>
                        <th className="pb-2 pr-4 font-medium">Before</th>
                        <th className="pb-2 font-medium">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log) => {
                        const after = log.after ?? {};
                        const before = log.before ?? {};
                        const locId = String(after.locationId ?? before.locationId ?? "");
                        const locName = (LOCATION_LABELS[locId] ?? locId) || "—";
                        const actionColor =
                          log.action.includes("DELETED") || log.action.includes("UNASSIGNED") ? "text-danger" :
                          log.action.includes("CREATED") || log.action.includes("APPROVED") ? "text-success" :
                          log.action.includes("PUBLISHED") ? "text-primary" :
                          log.action.includes("REJECTED") || log.action.includes("EXPIRED") || log.action.includes("CANCELLED") ? "text-warning" :
                          "text-foreground";

                        return (
                          <tr key={log.id} className="border-b last:border-0 align-top hover:bg-slate-50">
                            <td className="py-2.5 pr-4 whitespace-nowrap text-muted">
                              {new Date(log.createdAt).toLocaleString(undefined, {
                                month: "short", day: "numeric",
                                hour: "2-digit", minute: "2-digit",
                              })}
                            </td>
                            <td className={`py-2.5 pr-4 font-medium whitespace-nowrap ${actionColor}`}>
                              {log.action.replace(/_/g, " ")}
                            </td>
                            <td className="py-2.5 pr-4 whitespace-nowrap">{log.actorName}</td>
                            <td className="py-2.5 pr-4 whitespace-nowrap text-muted">{locName}</td>
                            <td className="py-2.5 pr-4 max-w-[200px] truncate text-muted" title={summarise(before)}>
                              {summarise(before)}
                            </td>
                            <td className="py-2.5 max-w-[220px] truncate text-muted" title={summarise(after)}>
                              {summarise(after)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Pagination */}
            {total > PAGE_SIZE && (
              <div className="mt-4 flex items-center gap-3 border-t pt-4 text-sm">
                <button
                  onClick={() => void load(page - 1)}
                  disabled={page === 0 || isFetching}
                  className="rounded-md border px-3 py-1 disabled:opacity-40 cursor-pointer"
                >
                  ← Prev
                </button>
                <span className="text-muted">
                  Page {page + 1} of {Math.ceil(total / PAGE_SIZE)} &nbsp;·&nbsp; {total} entries
                </span>
                <button
                  onClick={() => void load(page + 1)}
                  disabled={(page + 1) * PAGE_SIZE >= total || isFetching}
                  className="rounded-md border px-3 py-1 disabled:opacity-40 cursor-pointer"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
