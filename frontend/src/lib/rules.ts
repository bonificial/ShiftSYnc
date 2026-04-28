import { db } from "@/lib/store";
import { Shift, User } from "@/lib/types";

function overlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

export function validateAssignment(user: User, shift: Shift) {
  const state = db.getState();
  const shiftStart = new Date(shift.startsAt);
  const shiftEnd = new Date(shift.endsAt);

  if (!user.certifications.includes(shift.locationId)) {
    return {
      ok: false,
      reason: `${user.name} is not certified for this location`,
    };
  }

  if (!user.skills.includes(shift.requiredSkill)) {
    return {
      ok: false,
      reason: `${user.name} does not have required skill (${shift.requiredSkill})`,
    };
  }

  const userAssignments = state.shifts.filter((s) => s.assigneeIds.includes(user.id));
  for (const existing of userAssignments) {
    if (existing.id === shift.id) continue;
    const existingStart = new Date(existing.startsAt);
    const existingEnd = new Date(existing.endsAt);

    if (overlap(shiftStart, shiftEnd, existingStart, existingEnd)) {
      return {
        ok: false,
        reason: `${user.name} is already assigned to an overlapping shift`,
      };
    }

    const restFromExisting = (shiftStart.getTime() - existingEnd.getTime()) / 3600000;
    const restToExisting = (existingStart.getTime() - shiftEnd.getTime()) / 3600000;
    if ((restFromExisting > 0 && restFromExisting < 10) || (restToExisting > 0 && restToExisting < 10)) {
      return {
        ok: false,
        reason: `${user.name} does not satisfy minimum 10-hour rest rule`,
      };
    }
  }

  const day = shiftStart.getUTCDay();
  const hourStart = shiftStart.getUTCHours();
  const hourEnd = shiftEnd.getUTCHours();
  const window = state.availability.find((w) => w.userId === user.id && w.dayOfWeek === day);
  if (window && (hourStart < window.startHour || hourEnd > window.endHour)) {
    return {
      ok: false,
      reason: `${user.name} is outside declared availability window`,
    };
  }

  return { ok: true as const };
}

export function overtimeProjection(userId: string) {
  const shifts = db.getState().shifts.filter((s) => s.assigneeIds.includes(userId));
  let total = 0;
  for (const shift of shifts) {
    const duration =
      (new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime()) / 3600000;
    total += Math.max(duration, 0);
  }
  const warning = total >= 35;
  const overLimit = total > 40;
  return { totalHours: Math.round(total * 10) / 10, warning, overLimit };
}
