import { randomUUID } from "crypto";
import {
  AuditLog,
  AvailabilityWindow,
  Location,
  NotificationItem,
  Role,
  Shift,
  Skill,
  SwapRequest,
  User,
} from "@/lib/types";

type SessionMap = Record<string, string>;

interface AppState {
  users: User[];
  locations: Location[];
  availability: AvailabilityWindow[];
  shifts: Shift[];
  swaps: SwapRequest[];
  notifications: NotificationItem[];
  audit: AuditLog[];
  sessions: SessionMap;
}

const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
const iso = (offsetHours: number) =>
  new Date(today.getTime() + offsetHours * 60 * 60 * 1000).toISOString();

const state: AppState = {
  users: [
    {
      id: "u-admin",
      name: "Admin Jane",
      email: "admin@shiftsync.local",
      password: "admin123",
      role: "ADMIN",
      locationIds: ["l-east", "l-west"],
      certifications: ["l-east", "l-west"],
      skills: ["server"],
      desiredHours: 40,
    },
    {
      id: "u-manager-1",
      name: "Olivia Manager",
      email: "manager@shiftsync.local",
      password: "manager123",
      role: "MANAGER",
      locationIds: ["l-east", "l-west"],
      certifications: ["l-east", "l-west"],
      skills: ["host"],
      desiredHours: 40,
    },
    {
      id: "u-staff-1",
      name: "Sarah M",
      email: "sarah@shiftsync.local",
      password: "staff123",
      role: "STAFF",
      locationIds: ["l-east", "l-west"],
      certifications: ["l-east", "l-west"],
      skills: ["bartender", "server"],
      desiredHours: 32,
    },
    {
      id: "u-staff-2",
      name: "John K",
      email: "john@shiftsync.local",
      password: "staff123",
      role: "STAFF",
      locationIds: ["l-east"],
      certifications: ["l-east"],
      skills: ["bartender", "host"],
      desiredHours: 30,
    },
  ],
  locations: [
    { id: "l-east", name: "Harbor View", timezone: "America/New_York" },
    { id: "l-west", name: "Pier Grill", timezone: "America/Los_Angeles" },
  ],
  availability: [
    { userId: "u-staff-1", dayOfWeek: 2, startHour: 8, endHour: 23 },
    { userId: "u-staff-2", dayOfWeek: 2, startHour: 9, endHour: 18 },
  ],
  shifts: [
    {
      id: "s-1",
      locationId: "l-east",
      requiredSkill: "bartender",
      headcountNeeded: 1,
      startsAt: iso(16),
      endsAt: iso(23),
      published: false,
      assigneeIds: ["u-staff-1"],
      createdBy: "u-manager-1",
    },
    {
      id: "s-2",
      locationId: "l-west",
      requiredSkill: "line_cook",
      headcountNeeded: 1,
      startsAt: iso(18),
      endsAt: iso(26),
      published: false,
      assigneeIds: [],
      createdBy: "u-manager-1",
    },
  ],
  swaps: [],
  notifications: [],
  audit: [],
  sessions: {},
};

export const db = {
  getState: () => state,
  createSession(userId: string) {
    const token = randomUUID();
    state.sessions[token] = userId;
    return token;
  },
  getUserBySession(token: string | undefined) {
    if (!token) return null;
    const userId = state.sessions[token];
    if (!userId) return null;
    return state.users.find((u) => u.id === userId) ?? null;
  },
  destroySession(token: string | undefined) {
    if (!token) return;
    delete state.sessions[token];
  },
  log(actorId: string, action: string, before?: unknown, after?: unknown) {
    state.audit.unshift({
      id: randomUUID(),
      actorId,
      action,
      before,
      after,
      createdAt: new Date().toISOString(),
    });
  },
  notify(userIds: string[], title: string, body: string) {
    for (const userId of userIds) {
      state.notifications.unshift({
        id: randomUUID(),
        userId,
        title,
        body,
        read: false,
        createdAt: new Date().toISOString(),
      });
    }
  },
};

export function canManageLocation(role: Role, managerLocationIds: string[], locationId: string) {
  if (role === "ADMIN") return true;
  if (role !== "MANAGER") return false;
  return managerLocationIds.includes(locationId);
}

export function hasSkill(userSkills: Skill[], needed: Skill) {
  return userSkills.includes(needed);
}
