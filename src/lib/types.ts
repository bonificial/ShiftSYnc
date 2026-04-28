export type Role = "ADMIN" | "MANAGER" | "STAFF";

export type Skill = "bartender" | "line_cook" | "server" | "host";

export interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  role: Role;
  locationIds: string[];
  certifications: string[];
  skills: Skill[];
  desiredHours: number;
}

export interface Location {
  id: string;
  name: string;
  timezone: string;
}

export interface AvailabilityWindow {
  userId: string;
  dayOfWeek: number;
  startHour: number;
  endHour: number;
}

export interface Shift {
  id: string;
  locationId: string;
  requiredSkill: Skill;
  headcountNeeded: number;
  startsAt: string;
  endsAt: string;
  published: boolean;
  assigneeIds: string[];
  assigneeNames: string[];
  createdBy: string;
}

export type SwapType = "SWAP" | "DROP";
export type SwapStatus =
  | "PENDING_PARTY_ACCEPTANCE"
  | "PENDING_MANAGER_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED";

export interface SwapRequest {
  id: string;
  shiftId: string;
  requesterId: string;
  targetUserId?: string;
  type: SwapType;
  status: SwapStatus;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  createdAt: string;
}
