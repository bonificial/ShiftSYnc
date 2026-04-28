"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useCallback } from "react";

type User = { id: string; name: string; role: string; email: string; locations?: string[] };

type Shift = {
  id: string;
  seqId: number;
  locationId: string;
  requiredSkill: string;
  headcountNeeded: number;
  startsAt: string;
  endsAt: string;
  published: boolean;
  assigneeIds: string[];
  assigneeNames: string[];
};

type Swap = {
  id: string;
  shiftId: string;
  type: string;
  status: string;
  requesterId: string;
  requesterName?: string;
  targetUserId?: string;
  targetUserName?: string;
  startsAt?: string;
  endsAt?: string;
  locationId?: string;
  requiredSkill?: string;
};

type WeeklyAvailability = { id?: string; dayOfWeek: number; startHour: number; endHour: number };
type AvailabilityException = {
  id: string;
  date: string;
  isOff: boolean;
  startHour: number | null;
  endHour: number | null;
};
type StaffOption = { id: string; name: string; certifications: string[]; skills: string[] };
type AvailableShift = {
  swapRequestId: string;
  shiftId: string;
  locationId: string;
  requiredSkill: string;
  startsAt: string;
  endsAt: string;
  requesterName?: string;
};

type LaborWarning = { code: string; message: string; severity: "warn" | "block" };
type SimResult = {
  assigneeName: string;
  warnings: LaborWarning[];
  projectedDailyHours: number;
  projectedWeeklyHours: number;
  consecutiveDays: number;
  requiresOverride: boolean;
  hardBlocked: boolean;
};
type OvertimeEntry = {
  userId: string;
  name: string;
  totalHours: number;
  desiredHours: number;
  warning: boolean;
  overLimit: boolean;
  projectedCost: number;
  overtimeHours: number;
  shifts: { shiftId: string; hours: number; pushesIntoOvertime: boolean }[];
};

type OnDutyEntry = { userId: string; name: string };
type OnDutyMap = Record<string, OnDutyEntry[]>;

const EMPTY_SUMMARY = { openShifts: 0, pendingSwaps: 0, overtimeRisks: 0, onDutyNow: 0 };

type LocationMeta = { name: string; timezone: string };
type LocationsMap = Record<string, LocationMeta>;

const LOCATION_LABELS: Record<string, string> = {
  "l-east": "Harbor View",
  "l-west": "Pier Grill",
};

const CUID_RE = /\bc[a-z0-9]{20,}\b/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
function cleanNotifText(text: string): string {
  return text.replace(CUID_RE, "this shift").replace(UUID_RE, "this shift");
}

/** Format a UTC ISO string in a specific IANA timezone. Falls back to browser local if tz is missing. */
function fmt(iso: string, tz?: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Returns true when a shift crosses midnight in the given timezone. */
function isOvernight(startsAt: string, endsAt: string, tz?: string): boolean {
  const opts: Intl.DateTimeFormatOptions = { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" };
  return new Date(startsAt).toLocaleDateString("en-CA", opts) !==
         new Date(endsAt).toLocaleDateString("en-CA", opts);
}

/** Format just the time portion (no date) in a given timezone. */
function fmtTime(iso: string, tz?: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Full shift range.
 *  Same day:  "Apr 28, 11:00 AM → 7:00 PM"
 *  Overnight: "Apr 28, 11:00 PM → Apr 29, 3:00 AM"
 */
function fmtShift(startsAt: string, endsAt: string, tz?: string) {
  const start = fmt(startsAt, tz);
  if (isOvernight(startsAt, endsAt, tz)) {
    const end = fmt(endsAt, tz);   // include date for overnight end
    return `${start} → ${end}`;
  }
  return `${start} → ${fmtTime(endsAt, tz)}`;
}

/** Timezone abbreviation for display (e.g. "EDT"). */
function tzAbbr(tz?: string): string {
  if (!tz) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

function hourLabel(h: number) {
  return `${h.toString().padStart(2, "0")}:00`;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [notifications, setNotifications] = useState<{ id: string; title: string; body?: string; read: boolean; emailed?: boolean }[]>([]);
  type FairnessEntry = { userId: string; name: string; shiftCount: number; totalHours: number; bySkill: Record<string, number>; byLocation: Record<string, number> };
  const [analytics, setAnalytics] = useState<{
    overtime: OvertimeEntry[];
    totalProjectedCost: number;
    rates: { hourly: number; overtimeMultiplier: number };
    fairness: FairnessEntry[];
  }>({ overtime: [], totalProjectedCost: 0, rates: { hourly: 15, overtimeMultiplier: 1.5 }, fairness: [] });
  const [availableShifts, setAvailableShifts] = useState<AvailableShift[]>([]);
  const [onDutyByLocation, setOnDutyByLocation] = useState<OnDutyMap>({});
  const [sseConnected, setSseConnected] = useState(false);
  const [locations, setLocations] = useState<LocationsMap>({});
  const [notifPref, setNotifPref] = useState<"IN_APP" | "IN_APP_EMAIL">("IN_APP");
  const [isSavingPref, setIsSavingPref] = useState(false);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);

  type AuditEntry = {
    id: string; createdAt: string; action: string;
    actorName: string; actorRole: string;
    before: Record<string, unknown> | null; after: Record<string, unknown> | null;
  };

  const [successToast, setSuccessToast] = useState("");
  const [errorToast, setErrorToast] = useState("");

  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isCreatingShift, setIsCreatingShift] = useState(false);
  const [publishingShiftId, setPublishingShiftId] = useState<string | null>(null);
  const [unpublishingShiftId, setUnpublishingShiftId] = useState<string | null>(null);
  const [isSavingAvailability, setIsSavingAvailability] = useState(false);
  const [isAddingException, setIsAddingException] = useState(false);
  const [deletingExceptionId, setDeletingExceptionId] = useState<string | null>(null);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<Record<string, string>>({});
  const [assigningShiftId, setAssigningShiftId] = useState<string | null>(null);
  const [unassigningId, setUnassigningId] = useState<string | null>(null); // "shiftId:userId"
  const [isPublishingWeek, setIsPublishingWeek] = useState(false);
  const [isUnpublishingWeek, setIsUnpublishingWeek] = useState(false);
  const [claimingSwapId, setClaimingSwapId] = useState<string | null>(null);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ startsAt: "", endsAt: "", requiredSkill: "", headcountNeeded: 1 });
  const [isSavingShift, setIsSavingShift] = useState(false);
  const [deletingShiftId, setDeletingShiftId] = useState<string | null>(null);
  const [simResults, setSimResults] = useState<Record<string, SimResult>>({});
  const [simulatingShiftId, setSimulatingShiftId] = useState<string | null>(null);
  const [overrideModal, setOverrideModal] = useState<{ shiftId: string; assigneeId: string } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [acceptingSwapId, setAcceptingSwapId] = useState<string | null>(null);
  const [approvingSwapId, setApprovingSwapId] = useState<string | null>(null);
  const [rejectingSwapId, setRejectingSwapId] = useState<string | null>(null);
  const [cancellingSwapId, setCancellingSwapId] = useState<string | null>(null);
  const [isCreatingSwap, setIsCreatingSwap] = useState(false);
  const [swapFormShiftId, setSwapFormShiftId] = useState<string | null>(null);
  const [swapFormType, setSwapFormType] = useState<"SWAP" | "DROP">("DROP");
  const [swapFormTargetId, setSwapFormTargetId] = useState("");

  const [weeklyAvailability, setWeeklyAvailability] = useState<WeeklyAvailability[]>(
    Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i, startHour: 9, endHour: 17 })),
  );
  const [availabilityExceptions, setAvailabilityExceptions] = useState<AvailabilityException[]>([]);
  const [exceptionForm, setExceptionForm] = useState({ date: "", isOff: true, startHour: 9, endHour: 17 });
  const [weekPublishForm, setWeekPublishForm] = useState({ locationId: "l-east", weekStart: "" });
  const [credentials, setCredentials] = useState({ email: "manager@shiftsync.local", password: "manager123" });
  const [newShift, setNewShift] = useState({
    locationId: "l-east",
    requiredSkill: "bartender",
    startsAt: "",
    endsAt: "",
    headcountNeeded: 1,
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/bootstrap", { cache: "no-store" });
      if (!res.ok) {
        setUser(null);
        setSummary(EMPTY_SUMMARY);
        setShifts([]);
        setSwaps([]);
        setNotifications([]);
        setAnalytics({ overtime: [], totalProjectedCost: 0, rates: { hourly: 15, overtimeMultiplier: 1.5 }, fairness: [] });
        return;
      }
      const data = await res.json();
      if (!data.user) {
        setUser(null);
        setSummary(EMPTY_SUMMARY);
        setShifts([]);
        setSwaps([]);
        setNotifications([]);
        setAnalytics({ overtime: [], totalProjectedCost: 0, rates: { hourly: 15, overtimeMultiplier: 1.5 }, fairness: [] });
        return;
      }
      setUser(data.user);
      setSummary(data.summary ?? EMPTY_SUMMARY);
      setShifts(data.shifts ?? []);
      setSwaps(data.swaps ?? []);
      setNotifications(data.notifications ?? []);
      setAnalytics(data.analytics ?? { overtime: [], totalProjectedCost: 0, rates: { hourly: 15, overtimeMultiplier: 1.5 } });
      setOnDutyByLocation(data.onDutyByLocation ?? {});
      setLocations(data.locations ?? {});

      // Fetch notification pref in parallel
      fetch("/api/notifications/preferences", { cache: "no-store" })
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d?.notifPref) setNotifPref(d.notifPref as "IN_APP" | "IN_APP_EMAIL"); })
        .catch(() => null);

      if (data.user.role === "ADMIN" || data.user.role === "MANAGER") {
        const staffRes = await fetch("/api/staff", { cache: "no-store" });
        if (staffRes.ok) {
          const staffData = await staffRes.json();
          setStaffOptions(staffData.staff ?? []);
        } else {
          setStaffOptions([]);
        }
      } else {
        setStaffOptions([]);
      }

      if (data.user.role === "STAFF") {
        const [availRes, availShiftsRes] = await Promise.all([
          fetch("/api/availability", { cache: "no-store" }),
          fetch("/api/shifts/available", { cache: "no-store" }),
        ]);
        if (availRes.ok) {
          const ad = await availRes.json();
          const map = new Map<number, WeeklyAvailability>();
          for (const row of ad.weekly ?? []) {
            map.set(Number(row.dayOfWeek), {
              id: row.id,
              dayOfWeek: Number(row.dayOfWeek),
              startHour: Number(row.startHour),
              endHour: Number(row.endHour),
            });
          }
          setWeeklyAvailability(
            Array.from({ length: 7 }, (_, i) => map.get(i) ?? { dayOfWeek: i, startHour: 9, endHour: 17 }),
          );
          setAvailabilityExceptions(ad.exceptions ?? []);
        }
        if (availShiftsRes.ok) {
          const sd = await availShiftsRes.json();
          setAvailableShifts(sd.available ?? []);
        } else {
          setAvailableShifts([]);
        }
      }
    } finally {
      setCheckingAuth(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  useEffect(() => {
    if (!successToast) return;
    const t = setTimeout(() => setSuccessToast(""), 2600);
    return () => clearTimeout(t);
  }, [successToast]);

  useEffect(() => {
    if (!errorToast) return;
    const t = setTimeout(() => setErrorToast(""), 3200);
    return () => clearTimeout(t);
  }, [errorToast]);

  // ── Server-Sent Events for real-time updates ──────────────────────
  useEffect(() => {
    if (!user) return;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource("/api/realtime");

      es.addEventListener("open", () => setSseConnected(true));

      es.addEventListener("shift_update", () => {
        void refresh();
      });

      es.addEventListener("swap_update", () => {
        void refresh();
      });

      es.addEventListener("new_notification", () => {
        void refresh();
      });

      es.addEventListener("on_duty_update", (e) => {
        try {
          const map = JSON.parse((e as MessageEvent).data) as OnDutyMap;
          setOnDutyByLocation(map);
        } catch {
          // ignore parse errors
        }
      });

      es.onerror = () => {
        setSseConnected(false);
        es?.close();
        // Back-off reconnect after 3 s
        retryTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
      setSseConnected(false);
    };
  }, [user?.id, refresh]);

  async function login(e: FormEvent) {
    e.preventDefault();
    if (isSigningIn) return;
    setIsSigningIn(true);
    setErrorToast("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorToast(body.error ?? "Login failed");
        return;
      }
      await refresh();
    } finally {
      setIsSigningIn(false);
    }
  }

  async function logout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(null);
    } finally {
      setIsLoggingOut(false);
    }
  }

  async function markAllRead() {
    if (isMarkingAllRead) return;
    setIsMarkingAllRead(true);
    try {
      await fetch("/api/notifications", { method: "PATCH", body: "{}", headers: { "Content-Type": "application/json" } });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } finally {
      setIsMarkingAllRead(false);
    }
  }


  async function savePref(pref: "IN_APP" | "IN_APP_EMAIL") {
    if (isSavingPref) return;
    setIsSavingPref(true);
    setNotifPref(pref);
    try {
      await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifPref: pref }),
      });
    } finally {
      setIsSavingPref(false);
    }
  }

  async function createShift(e: FormEvent) {
    e.preventDefault();
    if (isCreatingShift) return;
    setIsCreatingShift(true);
    try {
      const res = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newShift),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorToast(body.error ?? "Failed to create shift");
        return;
      }
      await refresh();
      setSuccessToast("Shift created.");
    } finally {
      setIsCreatingShift(false);
    }
  }

  async function publishShift(id: string) {
    if (publishingShiftId) return;
    setPublishingShiftId(id);
    try {
      const res = await fetch(`/api/shifts/${id}/publish`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorToast(body.error ?? "Failed to publish shift");
        return;
      }
      await refresh();
      setSuccessToast("Shift published.");
    } finally {
      setPublishingShiftId(null);
    }
  }

  async function unpublishShift(id: string) {
    if (unpublishingShiftId) return;
    setUnpublishingShiftId(id);
    try {
      const res = await fetch(`/api/shifts/${id}/unpublish`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorToast(body.error ?? "Failed to unpublish shift");
        return;
      }
      await refresh();
      setSuccessToast("Shift unpublished.");
    } finally {
      setUnpublishingShiftId(null);
    }
  }

  async function simulateAssign(shiftId: string) {
    const assigneeId = selectedAssignees[shiftId];
    if (!assigneeId || simulatingShiftId) return;
    setSimulatingShiftId(shiftId);
    setSimResults((cur) => {
      const next = { ...cur };
      delete next[shiftId];
      return next;
    });
    try {
      const res = await fetch(`/api/shifts/${shiftId}/assign/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok || res.status === 400) {
        setSimResults((cur) => ({ ...cur, [shiftId]: data as SimResult }));
      }
    } finally {
      setSimulatingShiftId(null);
    }
  }

  async function saveShiftEdit(shiftId: string) {
    if (isSavingShift) return;
    setIsSavingShift(true);
    const payload: Record<string, unknown> = {};
    if (editForm.startsAt) payload.startsAt = new Date(editForm.startsAt).toISOString();
    if (editForm.endsAt) payload.endsAt = new Date(editForm.endsAt).toISOString();
    if (editForm.requiredSkill) payload.requiredSkill = editForm.requiredSkill;
    if (editForm.headcountNeeded) payload.headcountNeeded = editForm.headcountNeeded;
    try {
      const res = await fetch(`/api/shifts/${shiftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorToast(body.error ?? "Failed to update shift");
        return;
      }
      setEditingShiftId(null);
      await refresh();
      setSuccessToast("Shift updated. Any pending swaps were auto-cancelled and parties notified.");
    } finally {
      setIsSavingShift(false);
    }
  }

  async function deleteShift(shiftId: string) {
    if (deletingShiftId) return;
    setDeletingShiftId(shiftId);
    try {
      const res = await fetch(`/api/shifts/${shiftId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorToast(body.error ?? "Failed to delete shift");
        return;
      }
      await refresh();
      setSuccessToast("Shift deleted.");
    } finally {
      setDeletingShiftId(null);
    }
  }

  async function publishWeek() {
    if (isPublishingWeek || !weekPublishForm.weekStart) return;
    setIsPublishingWeek(true);
    try {
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish", ...weekPublishForm }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorToast(body.error ?? "Failed to publish week");
        return;
      }
      await refresh();
      setSuccessToast(`${body.published ?? 0} shift(s) published for the week.`);
    } finally {
      setIsPublishingWeek(false);
    }
  }

  async function unpublishWeek() {
    if (isUnpublishingWeek || !weekPublishForm.weekStart) return;
    setIsUnpublishingWeek(true);
    try {
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unpublish", ...weekPublishForm }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorToast(body.error ?? "Failed to unpublish week");
        return;
      }
      await refresh();
      const skipped = body.skipped ? ` (${body.skipped} skipped – within 48h cutoff)` : "";
      setSuccessToast(`${body.unpublished ?? 0} shift(s) unpublished.${skipped}`);
    } finally {
      setIsUnpublishingWeek(false);
    }
  }

  async function assignShift(shiftId: string, withOverride?: string) {
    const assigneeId = selectedAssignees[shiftId];
    if (!assigneeId || assigningShiftId) return;
    setAssigningShiftId(shiftId);
    setErrorToast("");
    try {
      const payload: Record<string, string> = { assigneeId };
      if (withOverride) payload.overrideReason = withOverride;
      const res = await fetch(`/api/shifts/${shiftId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.requiresOverride) {
          setOverrideModal({ shiftId, assigneeId });
          return;
        }
        setErrorToast(body.reason ?? body.error ?? "Failed to assign shift");
        return;
      }
      setSimResults((cur) => { const n = { ...cur }; delete n[shiftId]; return n; });
      setOverrideModal(null);
      setOverrideReason("");
      await refresh();
      setSuccessToast("Shift assigned.");
    } finally {
      setAssigningShiftId(null);
    }
  }

  async function unassignStaff(shiftId: string, userId: string) {
    const key = `${shiftId}:${userId}`;
    if (unassigningId) return;
    setUnassigningId(key);
    setErrorToast("");
    try {
      const res = await fetch(`/api/shifts/${shiftId}/assign`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorToast(body.error ?? "Failed to unassign");
        return;
      }
      await refresh();
      setSuccessToast("Staff unassigned.");
    } finally {
      setUnassigningId(null);
    }
  }

  async function submitSwapRequest() {
    if (!swapFormShiftId || isCreatingSwap) return;
    setIsCreatingSwap(true);
    try {
      const body: Record<string, unknown> = { shiftId: swapFormShiftId, type: swapFormType };
      if (swapFormType === "SWAP" && swapFormTargetId) body.targetUserId = swapFormTargetId;
      const res = await fetch("/api/swaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorToast(data.error ?? "Failed to create request");
        return;
      }
      setSwapFormShiftId(null);
      setSwapFormTargetId("");
      await refresh();
      setSuccessToast(swapFormType === "DROP" ? "Drop request submitted." : "Swap request sent.");
    } finally {
      setIsCreatingSwap(false);
    }
  }

  async function acceptSwap(id: string) {
    if (acceptingSwapId) return;
    setAcceptingSwapId(id);
    try {
      const res = await fetch(`/api/swaps/${id}/accept`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorToast(body.error ?? "Failed to accept swap");
        return;
      }
      await refresh();
      setSuccessToast("Swap accepted — awaiting manager approval.");
    } finally {
      setAcceptingSwapId(null);
    }
  }

  async function cancelSwap(id: string) {
    if (cancellingSwapId) return;
    setCancellingSwapId(id);
    try {
      const res = await fetch(`/api/swaps/${id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorToast(body.error ?? "Failed to cancel request");
        return;
      }
      await refresh();
      setSuccessToast("Swap/drop request withdrawn.");
    } finally {
      setCancellingSwapId(null);
    }
  }

  async function approveSwap(id: string, reject = false) {
    if (approvingSwapId || rejectingSwapId) return;
    reject ? setRejectingSwapId(id) : setApprovingSwapId(id);
    try {
      const res = await fetch(`/api/swaps/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reject }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorToast(body.error ?? "Failed to process swap");
        return;
      }
      await refresh();
      setSuccessToast(reject ? "Swap rejected." : "Swap approved.");
    } finally {
      setApprovingSwapId(null);
      setRejectingSwapId(null);
    }
  }

  async function claimShift(swapRequestId: string) {
    if (claimingSwapId) return;
    setClaimingSwapId(swapRequestId);
    try {
      const res = await fetch(`/api/swaps/${swapRequestId}/claim`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorToast(body.reason ?? body.error ?? "Failed to claim shift");
        return;
      }
      await refresh();
      setSuccessToast("Shift claimed — awaiting manager approval.");
    } finally {
      setClaimingSwapId(null);
    }
  }

  async function saveWeeklyAvailability() {
    if (isSavingAvailability) return;
    setIsSavingAvailability(true);
    setErrorToast("");
    try {
      const res = await fetch("/api/availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekly: weeklyAvailability.map((r) => ({
            dayOfWeek: r.dayOfWeek,
            startHour: r.startHour,
            endHour: r.endHour,
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorToast(body.error ?? "Failed to save availability");
        return;
      }
      const body = await res.json();
      const map = new Map<number, WeeklyAvailability>();
      for (const row of body.weekly ?? []) {
        map.set(Number(row.dayOfWeek), {
          id: row.id,
          dayOfWeek: Number(row.dayOfWeek),
          startHour: Number(row.startHour),
          endHour: Number(row.endHour),
        });
      }
      setWeeklyAvailability(
        Array.from({ length: 7 }, (_, i) => map.get(i) ?? { dayOfWeek: i, startHour: 9, endHour: 17 }),
      );
      await refresh();
      setSuccessToast("Weekly availability saved.");
    } finally {
      setIsSavingAvailability(false);
    }
  }

  async function addException() {
    if (isAddingException) return;
    setIsAddingException(true);
    try {
      const res = await fetch("/api/availability/exceptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exceptionForm),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorToast(body.error ?? "Failed to add exception");
        return;
      }
      setExceptionForm({ date: "", isOff: true, startHour: 9, endHour: 17 });
      await refresh();
      setSuccessToast("Availability exception added.");
    } finally {
      setIsAddingException(false);
    }
  }

  async function deleteException(id: string) {
    if (deletingExceptionId) return;
    setDeletingExceptionId(id);
    try {
      const res = await fetch(`/api/availability/exceptions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorToast(body.error ?? "Failed to delete exception");
        return;
      }
      await refresh();
      setSuccessToast("Exception removed.");
    } finally {
      setDeletingExceptionId(null);
    }
  }

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const topCards = useMemo(
    () => [
      { label: "Open Shifts", value: summary.openShifts },
      { label: "Pending Swaps", value: summary.pendingSwaps },
      { label: "Overtime Risks", value: summary.overtimeRisks },
      { label: "On Duty Now", value: summary.onDutyNow },
    ],
    [summary],
  );

  const myShiftIds = useMemo(
    () => new Set(shifts.map((s) => s.id)),
    [shifts],
  );

  const mySwaps = useMemo(
    () => (user ? swaps.filter((sw) => sw.requesterId === user.id || sw.targetUserId === user.id) : []),
    [swaps, user],
  );

  const pendingManagerSwaps = useMemo(
    () => swaps.filter((sw) => sw.status === "PENDING_MANAGER_APPROVAL"),
    [swaps],
  );

  const incomingSwaps = useMemo(
    () => (user ? swaps.filter((sw) => sw.targetUserId === user.id && sw.status === "PENDING_PARTY_ACCEPTANCE") : []),
    [swaps, user],
  );

  if (checkingAuth) {
    return (
      <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden px-4">
        <div
          className="fixed inset-0 scale-110 bg-cover bg-center bg-no-repeat blur-sm"
          style={{ backgroundImage: "url('/nastuh-abootalebi-eHD8Y1Znfpk-unsplash.jpg')" }}
        />
        <div className="fixed inset-0 bg-slate-900/45" />
        <div className="relative z-10 flex flex-col items-center gap-3">
          <div className="animate-[logoFloat_1.4s_ease-in-out_infinite]">
            <Image src="/logo.webp" alt="ShiftSync" width={180} height={180} priority style={{ height: "auto" }} />
          </div>
          <p className="text-sm text-white/80">Loading ShiftSync...</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden px-4">
        <div
          className="fixed inset-0 scale-110 bg-cover bg-center bg-no-repeat blur-sm"
          style={{ backgroundImage: "url('/nastuh-abootalebi-eHD8Y1Znfpk-unsplash.jpg')" }}
        />
        <div className="fixed inset-0 bg-slate-900/45" />
        <form onSubmit={login} className="relative z-10 w-full max-w-md rounded-2xl bg-card/95 p-6 shadow-sm">
          <div className="mb-3 flex justify-center">
            <Image src="/logo.webp" alt="ShiftSync" width={84} height={84} style={{ height: "auto" }} />
          </div>
          <h1 className="text-center text-2xl font-semibold">Welcome to ShiftSync</h1>
          {errorToast ? <p className="mt-2 text-center text-sm text-danger">{errorToast}</p> : null}
          <div className="mt-4 space-y-3">
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={credentials.email}
              onChange={(e) => setCredentials((v) => ({ ...v, email: e.target.value }))}
              placeholder="Email"
              disabled={isSigningIn}
            />
            <input
              type="password"
              className="w-full rounded-lg border px-3 py-2"
              value={credentials.password}
              onChange={(e) => setCredentials((v) => ({ ...v, password: e.target.value }))}
              placeholder="Password"
              disabled={isSigningIn}
            />
          </div>
          <button
            disabled={isSigningIn}
            className="mt-4 w-full rounded-lg bg-primary px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSigningIn ? "Signing in..." : "Sign in"}
          </button>
          <details className="mt-3 rounded-lg border p-3 text-xs">
            <summary className="cursor-pointer font-medium text-slate-700">Demo credentials</summary>
            <div className="mt-3 space-y-3 text-muted">
              {(
                [
                  {
                    group: "Admin & Manager",
                    accounts: [
                      { label: "Admin Jane", email: "admin@shiftsync.local", password: "admin123" },
                      { label: "Olivia Manager", email: "manager@shiftsync.local", password: "manager123" },
                    ],
                  },
                  {
                    group: "Harbor View staff",
                    accounts: [
                      { label: "Sarah M (bartender, server)", email: "sarah@shiftsync.local", password: "staff123" },
                      { label: "John K (bartender, host)", email: "john@shiftsync.local", password: "staff123" },
                      { label: "Marcus Reid (bartender, server)", email: "marcus@shiftsync.local", password: "staff123" },
                      { label: "Priya Nair (server, host)", email: "priya@shiftsync.local", password: "staff123" },
                      { label: "Tom Fletcher (line cook)", email: "tom@shiftsync.local", password: "staff123" },
                      { label: "Aisha Bakr (bartender, host)", email: "aisha@shiftsync.local", password: "staff123" },
                      { label: "Leo Santos (line cook, server)", email: "leo@shiftsync.local", password: "staff123" },
                    ],
                  },
                  {
                    group: "Pier Grill staff",
                    accounts: [
                      { label: "Nina Walsh (server, host)", email: "nina@shiftsync.local", password: "staff123" },
                      { label: "Dante Cruz (bartender)", email: "dante@shiftsync.local", password: "staff123" },
                      { label: "Yuki Tanaka (line cook, server)", email: "yuki@shiftsync.local", password: "staff123" },
                      { label: "Chloe Evans (host, bartender)", email: "chloe@shiftsync.local", password: "staff123" },
                      { label: "Kofi Mensah (line cook)", email: "kofi@shiftsync.local", password: "staff123" },
                    ],
                  },
                ] as { group: string; accounts: { label: string; email: string; password: string }[] }[]
              ).map((section) => (
                <div key={section.group}>
                  <p className="mb-1 font-semibold uppercase tracking-wide text-slate-500">{section.group}</p>
                  <div className="space-y-1">
                    {section.accounts.map((cred) => (
                      <p key={cred.email} className="flex items-center justify-between gap-2">
                        <span>
                          <span className="font-medium text-slate-700">{cred.label}</span>
                          <span className="ml-1 text-slate-400">— {cred.email}</span>
                        </span>
                        <button
                          type="button"
                          disabled={isSigningIn}
                          onClick={() => setCredentials({ email: cred.email, password: cred.password })}
                          className="shrink-0 text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Use ↗
                        </button>
                      </p>
                    ))}
                  </div>
                </div>
              ))}
              <p className="mt-2 border-t pt-2 text-slate-400">
                All staff passwords: <span className="font-mono font-semibold text-slate-600">staff123</span>
              </p>
            </div>
          </details>
        </form>
      </main>
    );
  }

  return (
    <div className="min-h-screen p-5 md:p-8">
      {successToast ? (
        <div className="fixed right-4 top-4 z-50 border border-green-300 bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {successToast}
        </div>
      ) : null}
      {errorToast ? (
        <div className="fixed right-4 top-16 z-50 border border-red-300 bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {errorToast}
        </div>
      ) : null}

      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
        <aside className="flex flex-col gap-4 lg:sticky lg:top-5 lg:self-start">
          <div className="rounded-2xl bg-card p-4 shadow-sm flex items-center gap-4">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <Image src="/logo.webp" alt="ShiftSync" width={48} height={48} style={{ height: "auto" }} />
              <p className="text-xs uppercase tracking-wide text-muted leading-none">ShiftSync</p>
            </div>
            <div className="h-10 w-px bg-border shrink-0" />
            <div className="flex-1 text-right">
              <p className="text-xs uppercase tracking-wide text-muted">{user.role} Console</p>
              <p className="mt-0.5 text-base font-semibold leading-tight">{user.name}</p>
              <p className="mt-0.5 text-xs text-muted">
                {user.locations?.join(", ") ?? user.email}
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-card p-4 shadow-sm">
            {/* Header row */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="font-semibold flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  {sseConnected ? (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
                    </>
                  ) : (
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-muted" />
                  )}
                </span>
                Notifications
              </h2>
              <div className="flex items-center gap-1.5">
                {notifications.filter((n) => !n.read).length > 0 && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-white">
                    {notifications.filter((n) => !n.read).length}
                  </span>
                )}
                {notifications.some((n) => !n.read) && (
                  <button
                    onClick={markAllRead}
                    disabled={isMarkingAllRead}
                    className="text-xs text-muted underline underline-offset-2 disabled:opacity-60"
                  >
                    {isMarkingAllRead ? "…" : "Mark all read"}
                  </button>
                )}
              </div>
            </div>

            {/* Preference toggle */}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-muted shrink-0">Notify via:</span>
              <div className="flex rounded-md border overflow-hidden text-xs">
                <button
                  onClick={() => void savePref("IN_APP")}
                  disabled={isSavingPref}
                  className={`px-2 py-0.5 ${notifPref === "IN_APP" ? "bg-primary text-white" : "text-muted"}`}
                >
                  In-app
                </button>
                <button
                  onClick={() => void savePref("IN_APP_EMAIL")}
                  disabled={isSavingPref}
                  className={`px-2 py-0.5 ${notifPref === "IN_APP_EMAIL" ? "bg-primary text-white" : "text-muted"}`}
                >
                  In-app + Email
                </button>
              </div>
            </div>

            {/* Notification list */}
            <div className="mt-3 space-y-2 max-h-[380px] overflow-y-auto pr-0.5">
              {notifications.length === 0 && (
                <p className="text-sm text-muted">No notifications.</p>
              )}
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`rounded-lg border p-2.5 ${n.read ? "opacity-50" : "border-primary/20 bg-primary/5"}`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-xs font-medium leading-snug">{cleanNotifText(n.title)}</p>
                    {!n.read && (
                      <span className="mt-0.5 shrink-0 h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </div>
                  {n.body && (
                    <p className="mt-0.5 text-xs text-muted leading-snug">{cleanNotifText(n.body)}</p>
                  )}
                  {n.emailed && (
                    <p className="mt-1 text-xs text-success/80 flex items-center gap-1">
                      <span>✉</span>
                      Email sent to {user?.email}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── Live On-Duty Now ─────────────────────────────────────── */}
          <div className="rounded-2xl bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <h2 className="font-semibold flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  {sseConnected ? (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
                    </>
                  ) : (
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-muted" />
                  )}
                </span>
                On Duty Now
              </h2>
              <span className="text-xs text-muted">
                {sseConnected ? "Live" : "Reconnecting…"}
              </span>
            </div>

            {Object.keys(onDutyByLocation).length === 0 ? (
              <p className="text-sm text-muted">No staff currently on shift.</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(onDutyByLocation).map(([locId, staff]) => (
                  <div key={locId} className="rounded-xl border p-3">
                    <p className="text-xs font-semibold text-primary mb-1.5">
                      {LOCATION_LABELS[locId] ?? locId}
                      <span className="ml-1.5 rounded-md bg-success/10 px-1.5 py-0.5 text-success">
                        {staff.length}
                      </span>
                    </p>
                    <ul className="space-y-1">
                      {staff.map((s) => (
                        <li key={s.userId} className="flex items-center gap-2 text-xs">
                          <span className="h-1.5 w-1.5 rounded-full bg-success flex-shrink-0" />
                          {s.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Audit Trail link (managers + admins) ─────────────── */}
          {(user.role === "MANAGER" || user.role === "ADMIN") && (
            <a
              href="/audit"
              className="flex items-center justify-between rounded-2xl border bg-card px-4 py-3 shadow-sm text-sm hover:bg-slate-50 transition-colors"
            >
              <div>
                <p className="font-medium">Audit Trail</p>
                <p className="text-xs text-muted mt-0.5">All schedule changes</p>
              </div>
              <span className="text-muted text-base">→</span>
            </a>
          )}

          <button
            onClick={logout}
            disabled={isLoggingOut}
            className="rounded-2xl border bg-card px-3 py-2.5 text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLoggingOut ? "Logging out…" : "Logout"}
          </button>
        </aside>

        <main className="space-y-5">
          <header className="rounded-2xl bg-card p-5 shadow-sm">
            <h2 className="text-2xl font-semibold">Operations Dashboard</h2>
          </header>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {topCards.map((card) => (
              <div key={card.label} className="rounded-2xl bg-card p-4 shadow-sm">
                <p className="text-sm text-muted">{card.label}</p>
                <p className="mt-2 text-3xl font-semibold">{card.value}</p>
              </div>
            ))}
          </section>

          {/* ── Fairness Report (managers + admins) ───────────────────── */}
          {(user.role === "MANAGER" || user.role === "ADMIN") && analytics.fairness.length > 0 && (
            <section className="rounded-2xl bg-card p-5 shadow-sm">
              <h3 className="text-lg font-semibold">Shift Distribution — Fairness Report</h3>
              <p className="mt-1 text-sm text-muted">This week · who gets how many shifts and of which type.</p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b text-left text-muted">
                      <th className="pb-2 pr-3 font-medium">Staff</th>
                      <th className="pb-2 pr-3 font-medium">Shifts</th>
                      <th className="pb-2 pr-3 font-medium">Hours</th>
                      <th className="pb-2 pr-3 font-medium">By Skill</th>
                      <th className="pb-2 font-medium">By Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.fairness.map((f) => (
                      <tr key={f.userId} className="border-b last:border-0 align-top">
                        <td className="py-2 pr-3 font-medium whitespace-nowrap">{f.name}</td>
                        <td className="py-2 pr-3">{f.shiftCount}</td>
                        <td className="py-2 pr-3">{Math.round(f.totalHours * 10) / 10}h</td>
                        <td className="py-2 pr-3 text-muted">
                          {Object.entries(f.bySkill).map(([skill, n]) => `${skill.replace("_", " ")} ×${n}`).join(", ")}
                        </td>
                        <td className="py-2 text-muted">
                          {Object.entries(f.byLocation).map(([loc, n]) => `${LOCATION_LABELS[loc] ?? loc} ×${n}`).join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted">
                If one staff member has significantly more or fewer shifts than peers with the same skill set, that may indicate a bias in scheduling. Cross-reference with the Audit Trail to see who made each assignment.
              </p>
            </section>
          )}

          {/* ── Swap Requests ─────────────────────────────────────────── */}
          <section className="rounded-2xl bg-card p-5 shadow-sm">
            <h3 className="text-lg font-semibold">
              {user.role === "STAFF" ? "My Swap & Drop Requests" : "Swap Requests"}
            </h3>

            {/* Staff: incoming swaps targeted at them */}
            {user.role === "STAFF" && incomingSwaps.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Requests targeting you</p>
                {incomingSwaps.map((sw) => (
                  <div key={sw.id} className="rounded-xl border p-3">
                    <p className="text-sm font-medium">
                      SWAP request from <span className="text-primary">{sw.requesterName}</span>
                    </p>
                    {sw.startsAt && (
                      <p className="text-xs text-muted">
                        Shift: {fmtShift(sw.startsAt, sw.endsAt ?? sw.startsAt)}
                      </p>
                    )}
                    <p className="text-xs text-muted">{sw.requiredSkill} @ {LOCATION_LABELS[sw.locationId ?? ""] ?? sw.locationId}</p>
                    <button
                      disabled={acceptingSwapId === sw.id}
                      onClick={() => acceptSwap(sw.id)}
                      className="mt-2 rounded-md bg-primary px-2 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {acceptingSwapId === sw.id ? "Accepting…" : "Accept Swap"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 space-y-2">
              {user.role === "STAFF" && mySwaps.length === 0 && incomingSwaps.length === 0 && (
                <p className="text-sm text-muted">No swap or drop requests yet.</p>
              )}
              {(user.role === "STAFF" ? mySwaps : swaps).map((sw) => (
                <div key={sw.id} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        <span className="rounded bg-card px-1 py-0.5 text-xs font-bold">{sw.type}</span>{" "}
                        by {sw.requesterName ?? "—"}
                        {sw.targetUserName ? ` → ${sw.targetUserName}` : ""}
                      </p>
                      {sw.startsAt && (
                        <p className="text-xs text-muted">
                          {fmtShift(sw.startsAt, sw.endsAt ?? sw.startsAt)} · {sw.requiredSkill}{" "}
                          @ {LOCATION_LABELS[sw.locationId ?? ""] ?? sw.locationId}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted">{sw.status.replace(/_/g, " ")}</p>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {/* Manager approve/reject */}
                      {(user.role === "MANAGER" || user.role === "ADMIN") &&
                        sw.status === "PENDING_MANAGER_APPROVAL" && (
                          <>
                            <button
                              disabled={approvingSwapId === sw.id || !!rejectingSwapId}
                              onClick={() => approveSwap(sw.id, false)}
                              className="rounded-md bg-success px-2 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              {approvingSwapId === sw.id ? "Approving…" : "Approve"}
                            </button>
                            <button
                              disabled={rejectingSwapId === sw.id || !!approvingSwapId}
                              onClick={() => approveSwap(sw.id, true)}
                              className="rounded-md bg-danger px-2 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              {rejectingSwapId === sw.id ? "Rejecting…" : "Reject"}
                            </button>
                          </>
                        )}

                      {/* Requester or target can withdraw while still pending */}
                      {(sw.requesterId === user?.id || sw.targetUserId === user?.id) &&
                        ["PENDING_PARTY_ACCEPTANCE", "PENDING_MANAGER_APPROVAL"].includes(sw.status) && (
                          <button
                            disabled={cancellingSwapId === sw.id}
                            onClick={() => cancelSwap(sw.id)}
                            className="rounded-md border border-danger/40 px-2 py-1 text-xs text-danger disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {cancellingSwapId === sw.id ? "Withdrawing…" : "Withdraw"}
                          </button>
                        )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Available Shifts to Pick Up (Staff only) ───────────────── */}
          {user.role === "STAFF" && (
            <section className="rounded-2xl bg-card p-5 shadow-sm">
              <h3 className="text-lg font-semibold">Available Shifts to Pick Up</h3>
              <p className="mt-1 text-sm text-muted">Open drop requests you qualify for.</p>
              <div className="mt-3 space-y-2">
                {availableShifts.length === 0 && (
                  <p className="text-sm text-muted">No available shifts right now.</p>
                )}
                {availableShifts
                  .filter((s) => !myShiftIds.has(s.shiftId))
                  .map((s) => (
                    <div key={s.swapRequestId} className="flex items-start justify-between rounded-xl border p-3">
                      <div>
                        <p className="text-sm font-medium">
                          {s.requiredSkill}{" "}
                          <span className="text-muted">@ {LOCATION_LABELS[s.locationId] ?? s.locationId}</span>
                        </p>
                        <p className="text-xs text-muted">
                          {fmtShift(s.startsAt, s.endsAt)}
                        </p>
                        {s.requesterName && (
                          <p className="text-xs text-muted">Dropped by {s.requesterName}</p>
                        )}
                      </div>
                      <button
                        disabled={claimingSwapId === s.swapRequestId}
                        onClick={() => claimShift(s.swapRequestId)}
                        className="rounded-md bg-primary px-2 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {claimingSwapId === s.swapRequestId ? "Claiming…" : "Claim Shift"}
                      </button>
                    </div>
                  ))}
              </div>
            </section>
          )}

          {/* ── Overtime Projection (managers/admins only) ─────────────── */}
          {(user.role === "MANAGER" || user.role === "ADMIN") && (
            <section>
            {(user.role === "MANAGER" || user.role === "ADMIN") && (
              <div className="rounded-2xl bg-card p-5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-lg font-semibold">Overtime Projection</h3>
                  {analytics.totalProjectedCost > 0 && (
                    <div className="text-right">
                      <p className="text-xs text-muted">Projected weekly cost</p>
                      <p className="text-xl font-bold text-primary">${analytics.totalProjectedCost.toFixed(2)}</p>
                      <p className="text-xs text-muted">${analytics.rates.hourly}/h · OT ×{analytics.rates.overtimeMultiplier}</p>
                    </div>
                  )}
                </div>
                <div className="mt-3 space-y-2">
                  {analytics.overtime.length === 0 && (
                    <p className="text-sm text-muted">No assignments this week yet.</p>
                  )}
                  {analytics.overtime.map((o) => (
                    <div key={o.userId} className="rounded-xl border p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">{o.name}</p>
                        <div className="flex items-center gap-2">
                          {o.overtimeHours > 0 && (
                            <span className="text-xs text-danger font-medium">+{o.overtimeHours}h OT</span>
                          )}
                          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${
                            o.overLimit ? "bg-danger/10 text-danger" : o.warning ? "bg-warning/10 text-warning" : "bg-success/10 text-success"
                          }`}>
                            {o.totalHours}h
                          </span>
                          <span className="text-xs text-muted">${o.projectedCost.toFixed(0)}</span>
                        </div>
                      </div>
                      {/* Progress bar */}
                      <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100">
                        <div
                          className={`h-1.5 rounded-full ${o.overLimit ? "bg-danger" : o.warning ? "bg-warning" : "bg-success"}`}
                          style={{ width: `${Math.min(100, (o.totalHours / 45) * 100)}%` }}
                        />
                      </div>
                      <div className="mt-0.5 flex justify-between text-xs text-muted">
                        <span>0h</span>
                        <span className="text-warning">35h</span>
                        <span className="text-danger">40h</span>
                        <span>45h</span>
                      </div>
                      {/* Flag shifts that push into overtime */}
                      {o.shifts.some((s) => s.pushesIntoOvertime) && (
                        <p className="mt-1 text-xs text-danger">
                          ⚠ One shift this week pushes {o.name} into overtime
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            </section>
          )}

          {/* ── Manager: Create Shift + Publish Week ─────────────────── */}
          {(user.role === "MANAGER" || user.role === "ADMIN") && (
            <section className="rounded-2xl bg-card p-5 shadow-sm">
              <h3 className="text-lg font-semibold">Create Shift</h3>
              <form onSubmit={createShift} className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                <select
                  className="rounded-lg border px-2 py-2"
                  value={newShift.locationId}
                  onChange={(e) => setNewShift((v) => ({ ...v, locationId: e.target.value }))}
                >
                  <option value="l-east">Harbor View</option>
                  <option value="l-west">Pier Grill</option>
                </select>
                <select
                  className="rounded-lg border px-2 py-2"
                  value={newShift.requiredSkill}
                  onChange={(e) => setNewShift((v) => ({ ...v, requiredSkill: e.target.value }))}
                >
                  <option value="bartender">Bartender</option>
                  <option value="line_cook">Line Cook</option>
                  <option value="server">Server</option>
                  <option value="host">Host</option>
                </select>
                <input
                  type="datetime-local"
                  className="rounded-lg border px-2 py-2"
                  onChange={(e) =>
                    setNewShift((v) => ({ ...v, startsAt: new Date(e.target.value).toISOString() }))
                  }
                />
                <input
                  type="datetime-local"
                  className="rounded-lg border px-2 py-2"
                  onChange={(e) =>
                    setNewShift((v) => ({ ...v, endsAt: new Date(e.target.value).toISOString() }))
                  }
                />
                <button
                  disabled={isCreatingShift}
                  className="rounded-lg bg-primary px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isCreatingShift ? "Creating…" : "Create Shift"}
                </button>
              </form>

              <div className="mt-6 border-t pt-4">
                <h4 className="text-base font-semibold">Publish / Unpublish Week</h4>
                <p className="mt-1 text-xs text-muted">
                  Publishes all draft shifts for a location in the selected week. Unpublish respects the 48-hour
                  cutoff — shifts starting within 48h cannot be unpublished.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <select
                    className="rounded-lg border px-2 py-2 text-sm"
                    value={weekPublishForm.locationId}
                    onChange={(e) => setWeekPublishForm((v) => ({ ...v, locationId: e.target.value }))}
                  >
                    <option value="l-east">Harbor View</option>
                    <option value="l-west">Pier Grill</option>
                  </select>
                  <input
                    type="date"
                    className="rounded-lg border px-2 py-2 text-sm"
                    value={weekPublishForm.weekStart}
                    onChange={(e) => setWeekPublishForm((v) => ({ ...v, weekStart: e.target.value }))}
                  />
                  <button
                    type="button"
                    disabled={isPublishingWeek || !weekPublishForm.weekStart}
                    onClick={publishWeek}
                    className="rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isPublishingWeek ? "Publishing…" : "Publish Week"}
                  </button>
                  <button
                    type="button"
                    disabled={isUnpublishingWeek || !weekPublishForm.weekStart}
                    onClick={unpublishWeek}
                    className="rounded-lg border px-3 py-2 text-sm text-danger disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isUnpublishingWeek ? "Unpublishing…" : "Unpublish Week"}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* ── Staff: My Availability ─────────────────────────────────── */}
          {user.role === "STAFF" && (
            <section className="rounded-2xl bg-card p-5 shadow-sm">
              <h3 className="text-lg font-semibold">My Availability</h3>
              <p className="mt-1 text-sm text-muted">Set weekly recurring windows and one-off date exceptions.</p>

              <div className="mt-4 space-y-2">
                {weeklyAvailability.map((row, idx) => (
                  <div key={row.dayOfWeek} className="grid grid-cols-[80px_1fr_1fr] items-center gap-2">
                    <p className="text-sm font-medium">{dayNames[row.dayOfWeek]}</p>
                    <select
                      className="rounded-lg border px-2 py-2 text-sm"
                      value={row.startHour}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setWeeklyAvailability((cur) =>
                          cur.map((item, i) => (i === idx ? { ...item, startHour: val } : item)),
                        );
                      }}
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={`s${row.dayOfWeek}-${i}`} value={i}>
                          {hourLabel(i)}
                        </option>
                      ))}
                    </select>
                    <select
                      className="rounded-lg border px-2 py-2 text-sm"
                      value={row.endHour}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setWeeklyAvailability((cur) =>
                          cur.map((item, i) => (i === idx ? { ...item, endHour: val } : item)),
                        );
                      }}
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={`e${row.dayOfWeek}-${i}`} value={i}>
                          {hourLabel(i)}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={saveWeeklyAvailability}
                disabled={isSavingAvailability}
                className="mt-4 rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSavingAvailability ? "Saving…" : "Save Weekly Availability"}
              </button>

              <div className="mt-6 border-t pt-4">
                <h4 className="text-base font-semibold">One-off Exceptions</h4>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  <input
                    type="date"
                    className="rounded-lg border px-2 py-2 text-sm"
                    value={exceptionForm.date}
                    onChange={(e) => setExceptionForm((v) => ({ ...v, date: e.target.value }))}
                  />
                  <select
                    className="rounded-lg border px-2 py-2 text-sm"
                    value={exceptionForm.isOff ? "off" : "window"}
                    onChange={(e) => setExceptionForm((v) => ({ ...v, isOff: e.target.value === "off" }))}
                  >
                    <option value="off">Unavailable all day</option>
                    <option value="window">Custom window</option>
                  </select>
                  <select
                    className="rounded-lg border px-2 py-2 text-sm"
                    value={exceptionForm.startHour}
                    disabled={exceptionForm.isOff}
                    onChange={(e) => setExceptionForm((v) => ({ ...v, startHour: Number(e.target.value) }))}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={`xs${i}`} value={i}>
                        {hourLabel(i)}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded-lg border px-2 py-2 text-sm"
                    value={exceptionForm.endHour}
                    disabled={exceptionForm.isOff}
                    onChange={(e) => setExceptionForm((v) => ({ ...v, endHour: Number(e.target.value) }))}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={`xe${i}`} value={i}>
                        {hourLabel(i)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={addException}
                    disabled={isAddingException || !exceptionForm.date}
                    className="rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isAddingException ? "Adding…" : "Add Exception"}
                  </button>
                </div>

                <div className="mt-3 space-y-2">
                  {availabilityExceptions.map((ex) => (
                    <div key={ex.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                      <p className="text-sm">
                        <span className="font-medium">{new Date(ex.date).toLocaleDateString()}</span>{" "}
                        {ex.isOff
                          ? "— unavailable all day"
                          : `— ${hourLabel(ex.startHour ?? 0)} to ${hourLabel(ex.endHour ?? 0)}`}
                      </p>
                      <button
                        type="button"
                        onClick={() => deleteException(ex.id)}
                        disabled={deletingExceptionId === ex.id}
                        className="rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {deletingExceptionId === ex.id ? "Removing…" : "Remove"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* ── Shifts ─────────────────────────────────────────────────── */}
          <section className="rounded-2xl bg-card p-5 shadow-sm">
            <h3 className="text-lg font-semibold">
              {user.role === "STAFF" ? "My Assigned Shifts" : "Shifts"}
            </h3>
            <div className="mt-3 space-y-3">
              {shifts.length === 0 && (
                <p className="text-sm text-muted">No shifts found.</p>
              )}
              {shifts.map((shift) => {
                const overnight = isOvernight(shift.startsAt, shift.endsAt);
                return (
                <div key={shift.id} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        <span className="text-xs font-bold text-muted mr-1">#{shift.seqId}</span>
                        {shift.requiredSkill}{" "}
                        <span className="text-muted">@ {LOCATION_LABELS[shift.locationId] ?? shift.locationId}</span>
                        {overnight && (
                          <span className="ml-1.5 rounded bg-warning/10 px-1 py-0.5 text-xs text-warning">overnight</span>
                        )}
                      </p>
                      <p className="text-sm text-muted">
                        {fmtShift(shift.startsAt, shift.endsAt)}
                      </p>
                      <p className="text-xs text-muted">
                        Assigned {shift.assigneeIds.length}/{shift.headcountNeeded}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {shift.published ? (
                        shift.assigneeNames.length > 0 ? (
                          <span className="rounded-md bg-success/10 px-2 py-1 text-xs text-success">
                            Published · {shift.assigneeNames.join(", ")}
                          </span>
                        ) : (
                          <span className="rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
                            Published · Unassigned
                          </span>
                        )
                      ) : (
                        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-500">Draft</span>
                      )}
                    </div>
                  </div>

                  {/* Manager/Admin actions */}
                  {(user.role === "MANAGER" || user.role === "ADMIN") && (
                    <>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {/* Assign staff — only for published shifts */}
                        {!shift.published && (
                          <span className="rounded-md border border-dashed px-2 py-1 text-xs text-muted italic">
                            Publish shift to enable assignment
                          </span>
                        )}
                        {shift.published && shift.assigneeIds.length >= shift.headcountNeeded && (
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-xs text-muted italic mr-1">Full — reassign:</span>
                            {shift.assigneeNames.map((name, i) => {
                              const uid = shift.assigneeIds[i];
                              const key = `${shift.id}:${uid}`;
                              const removing = unassigningId === key;
                              return removing ? (
                                <span key={uid} className="flex items-center gap-1 rounded border border-dashed px-2 py-1 text-xs text-muted italic">
                                  Removing {name}…
                                </span>
                              ) : (
                                <span key={uid} className="flex items-center gap-1 rounded border px-2 py-1 text-xs">
                                  {name}
                                  <button
                                    type="button"
                                    disabled={!!unassigningId}
                                    onClick={() => unassignStaff(shift.id, uid)}
                                    className="ml-1 flex h-4 w-4 items-center justify-center rounded text-sm font-bold leading-none text-danger hover:bg-danger/10 disabled:opacity-40"
                                    title={`Unassign ${name}`}
                                  >
                                    ×
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {shift.published && shift.assigneeIds.length < shift.headcountNeeded && (
                          <>
                        <select
                          className="rounded-md border px-2 py-1 text-xs"
                          value={selectedAssignees[shift.id] ?? ""}
                          onChange={(e) => {
                            setSelectedAssignees((cur) => ({ ...cur, [shift.id]: e.target.value }));
                            setSimResults((cur) => { const n = { ...cur }; delete n[shift.id]; return n; });
                          }}
                          disabled={assigningShiftId === shift.id}
                        >
                          <option value="">Assign staff…</option>
                          {staffOptions
                            .filter(
                              (s) =>
                                s.certifications.includes(shift.locationId) &&
                                s.skills.includes(shift.requiredSkill) &&
                                !shift.assigneeIds.includes(s.id),
                            )
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          disabled={!selectedAssignees[shift.id] || simulatingShiftId === shift.id}
                          onClick={() => simulateAssign(shift.id)}
                          className="rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {simulatingShiftId === shift.id ? "Checking…" : "Preview"}
                        </button>
                        <button
                          type="button"
                          disabled={
                            !selectedAssignees[shift.id] ||
                            assigningShiftId === shift.id ||
                            simResults[shift.id]?.hardBlocked === true
                          }
                          onClick={() => assignShift(shift.id)}
                          className="rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {assigningShiftId === shift.id ? "Assigning…" : "Assign"}
                        </button>
                          </>
                        )}

                        {/* Simulation result badge */}
                        {simResults[shift.id] && (() => {
                          const sim = simResults[shift.id];
                          const hasBlock = sim.warnings.some((w) => w.severity === "block");
                          return (
                            <span className={`rounded px-2 py-1 text-xs font-semibold ${hasBlock ? "bg-danger/10 text-danger" : sim.warnings.length ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>
                              {hasBlock ? "Blocked" : sim.warnings.length ? `${sim.warnings.length} warning(s)` : "Clear"}
                            </span>
                          );
                        })()}

                        {/* Publish / Unpublish */}
                        {!shift.published ? (
                          <button
                            disabled={publishingShiftId === shift.id}
                            onClick={() => publishShift(shift.id)}
                            className="rounded-md bg-primary px-2 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {publishingShiftId === shift.id ? "Publishing…" : "Publish"}
                          </button>
                        ) : (
                          <button
                            disabled={unpublishingShiftId === shift.id}
                            onClick={() => unpublishShift(shift.id)}
                            className="rounded-md border px-2 py-1 text-xs text-danger disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {unpublishingShiftId === shift.id ? "Unpublishing…" : "Unpublish"}
                          </button>
                        )}

                        {/* Edit */}
                        <button
                          type="button"
                          onClick={() => {
                            setEditingShiftId(editingShiftId === shift.id ? null : shift.id);
                            setEditForm({
                              startsAt: "",
                              endsAt: "",
                              requiredSkill: shift.requiredSkill,
                              headcountNeeded: shift.headcountNeeded,
                            });
                          }}
                          className="rounded-md border px-2 py-1 text-xs"
                        >
                          {editingShiftId === shift.id ? "Cancel" : "Edit"}
                        </button>

                        {/* Delete */}
                        <button
                          type="button"
                          disabled={deletingShiftId === shift.id}
                          onClick={() => deleteShift(shift.id)}
                          className="rounded-md border border-danger px-2 py-1 text-xs text-danger disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {deletingShiftId === shift.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>

                      {/* Simulation detail panel */}
                      {simResults[shift.id] && simResults[shift.id].warnings.length > 0 && (
                        <div className="mt-2 rounded-lg border p-3 text-xs space-y-1">
                          <p className="font-semibold text-slate-600 uppercase tracking-wide">
                            What-if preview — {simResults[shift.id].assigneeName}
                          </p>
                          <p className="text-muted">
                            Daily: <strong>{simResults[shift.id].projectedDailyHours.toFixed(1)}h</strong>
                            {" · "}Weekly: <strong>{simResults[shift.id].projectedWeeklyHours.toFixed(1)}h</strong>
                            {" · "}Consecutive days: <strong>{simResults[shift.id].consecutiveDays}</strong>
                          </p>
                          {simResults[shift.id].warnings.map((w) => (
                            <div key={w.code} className={`flex items-start gap-1 rounded px-2 py-1 ${w.severity === "block" ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning"}`}>
                              <span>{w.severity === "block" ? "✗" : "⚠"}</span>
                              <span>{w.message}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Inline edit form */}
                      {editingShiftId === shift.id && (
                        <div className="mt-3 space-y-2 rounded-lg border p-3">
                          <p className="text-xs font-semibold text-muted uppercase tracking-wide">
                            Edit shift — any pending swaps will be auto-cancelled
                          </p>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs text-muted">Start time</label>
                              <input
                                type="datetime-local"
                                className="w-full rounded-md border px-2 py-1 text-xs"
                                value={editForm.startsAt}
                                onChange={(e) => setEditForm((v) => ({ ...v, startsAt: e.target.value }))}
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-muted">End time</label>
                              <input
                                type="datetime-local"
                                className="w-full rounded-md border px-2 py-1 text-xs"
                                value={editForm.endsAt}
                                onChange={(e) => setEditForm((v) => ({ ...v, endsAt: e.target.value }))}
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-muted">Required skill</label>
                              <select
                                className="w-full rounded-md border px-2 py-1 text-xs"
                                value={editForm.requiredSkill}
                                onChange={(e) => setEditForm((v) => ({ ...v, requiredSkill: e.target.value }))}
                              >
                                <option value="bartender">Bartender</option>
                                <option value="line_cook">Line Cook</option>
                                <option value="server">Server</option>
                                <option value="host">Host</option>
                              </select>
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-muted">Headcount needed</label>
                              <input
                                type="number"
                                min={1}
                                className="w-full rounded-md border px-2 py-1 text-xs"
                                value={editForm.headcountNeeded}
                                onChange={(e) =>
                                  setEditForm((v) => ({ ...v, headcountNeeded: Number(e.target.value) }))
                                }
                              />
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={isSavingShift}
                            onClick={() => saveShiftEdit(shift.id)}
                            className="rounded-md bg-primary px-3 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {isSavingShift ? "Saving…" : "Save Changes"}
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  {/* Staff swap/drop actions */}
                  {user.role === "STAFF" && (
                    <div className="mt-2">
                      {swapFormShiftId === shift.id ? (
                        <div className="mt-2 space-y-2 rounded-lg border p-3">
                          <div className="flex gap-2">
                            <label className="flex items-center gap-1 text-xs">
                              <input
                                type="radio"
                                checked={swapFormType === "DROP"}
                                onChange={() => setSwapFormType("DROP")}
                              />{" "}
                              Drop shift
                            </label>
                            <label className="flex items-center gap-1 text-xs">
                              <input
                                type="radio"
                                checked={swapFormType === "SWAP"}
                                onChange={() => setSwapFormType("SWAP")}
                              />{" "}
                              Swap with colleague
                            </label>
                          </div>
                          {swapFormType === "SWAP" && (
                            <p className="text-xs text-muted">
                              A swap request will be sent to a colleague. They can accept, then a manager approves.
                            </p>
                          )}
                          {swapFormType === "DROP" && (
                            <p className="text-xs text-muted">
                              Your shift will be offered for pickup. Another staff can claim it; manager approves.
                            </p>
                          )}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={isCreatingSwap}
                              onClick={submitSwapRequest}
                              className="rounded-md bg-primary px-2 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              {isCreatingSwap ? "Submitting…" : "Submit"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setSwapFormShiftId(null)}
                              className="rounded-md border px-2 py-1 text-xs"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setSwapFormShiftId(shift.id);
                            setSwapFormType("DROP");
                            setSwapFormTargetId("");
                          }}
                          className="mt-1 rounded-md border px-2 py-1 text-xs"
                        >
                          Request Swap / Drop
                        </button>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </section>
        </main>
      </div>

      {/* 7th-day override modal */}
      {overrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-danger">Manager Override Required</h3>
            <p className="mt-2 text-sm text-muted">
              This assignment places the staff member on their <strong>7th consecutive working day</strong>. Labour
              regulations require a documented reason for this override.
            </p>
            <textarea
              className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
              rows={3}
              placeholder="State the business reason for this override…"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={overrideReason.trim().length < 5 || assigningShiftId === overrideModal.shiftId}
                onClick={() => assignShift(overrideModal.shiftId, overrideReason)}
                className="rounded-lg bg-danger px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-70"
              >
                {assigningShiftId === overrideModal.shiftId ? "Assigning…" : "Confirm Override"}
              </button>
              <button
                type="button"
                onClick={() => { setOverrideModal(null); setOverrideReason(""); }}
                className="rounded-lg border px-3 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
