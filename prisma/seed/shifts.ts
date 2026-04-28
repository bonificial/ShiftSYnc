import { PrismaClient, Skill } from "@prisma/client";
import type { SeededUsers } from "./users";

/** Returns midnight UTC for "today + offsetDays" */
function day(offsetDays: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}
function h(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 3600_000);
}

export async function seedShifts(prisma: PrismaClient, u: SeededUsers) {
  const today = day(0);
  const yesterday = day(-1);
  const lastWeekMon = day(-7);

  // ── 1. Normal published shift (today, afternoon) ───────────────────
  const shift1 = await prisma.shift.create({
    data: {
      locationId: "l-east",
      requiredSkill: Skill.bartender,
      headcountNeeded: 2,
      startsAt: h(today, 16), // 4 PM UTC (≈ 12 PM ET)
      endsAt:   h(today, 22), // 10 PM UTC
      published: true,
      createdBy: u.managerOlivia.id,
      assignments: { create: [{ userId: u.sarah.id }] }, // 1 of 2 assigned → open slot
    },
  });

  // ── 2. Overnight shift (today 11 PM → tomorrow 3 AM) ──────────────
  const shift2 = await prisma.shift.create({
    data: {
      locationId: "l-west",
      requiredSkill: Skill.line_cook,
      headcountNeeded: 1,
      startsAt: h(today, 23),
      endsAt:   h(day(1), 3),
      published: true,
      createdBy: u.managerDante.id,
      assignments: { create: [{ userId: u.kofi.id }] },
    },
  });

  // ── 3. Multi-person shift, fully staffed ──────────────────────────
  await prisma.shift.create({
    data: {
      locationId: "l-east",
      requiredSkill: Skill.server,
      headcountNeeded: 3,
      startsAt: h(today, 12),
      endsAt:   h(today, 18),
      published: true,
      createdBy: u.managerOlivia.id,
      assignments: { create: [{ userId: u.marcus.id }, { userId: u.priya.id }, { userId: u.leo.id }] },
    },
  });

  // ── 4. Draft / unpublished shift (staff cannot see it yet) ─────────
  await prisma.shift.create({
    data: {
      locationId: "l-east",
      requiredSkill: Skill.host,
      headcountNeeded: 1,
      startsAt: h(day(2), 14),
      endsAt:   h(day(2), 20),
      published: false,
      createdBy: u.managerOlivia.id,
    },
  });

  // ── 5. Emergency drop scenario (shift starts in ~2 h, no one assigned yet) ─
  //    This shift's drop request (if created) should NOT be expired by expireStaleDrops.
  const emergencyShift = await prisma.shift.create({
    data: {
      locationId: "l-east",
      requiredSkill: Skill.bartender,
      headcountNeeded: 1,
      startsAt: h(today, new Date().getUTCHours() + 2),
      endsAt:   h(today, new Date().getUTCHours() + 6),
      published: true,
      createdBy: u.managerOlivia.id,
      assignments: { create: [{ userId: u.john.id }] },
    },
  });
  // John drops the shift — simulates "Sunday Night Chaos"
  await prisma.swapRequest.create({
    data: {
      shiftId:     emergencyShift.id,
      requesterId: u.john.id,
      type:        "DROP",
      status:      "PENDING_MANAGER_APPROVAL",
    },
  });

  // ── 6. Overtime Trap: Marcus has 36 h already this week ───────────
  //    One more 8-h shift will cross 40 h (hard block).
  //    Four more 4-h shifts will build the 36 h baseline.
  const otBase = [day(-6), day(-5), day(-4), day(-3)];
  for (const d of otBase) {
    await prisma.shift.create({
      data: {
        locationId: "l-east",
        requiredSkill: Skill.bartender,
        headcountNeeded: 1,
        startsAt: h(d, 12),
        endsAt:   h(d, 21), // 9 h each = 36 h total
        published: true,
        createdBy: u.managerOlivia.id,
        assignments: { create: [{ userId: u.marcus.id }] },
      },
    });
  }
  // The next assignment attempt for Marcus will trigger a hard-block warning.
  // An unassigned shift waiting for Marcus (the "trap"):
  await prisma.shift.create({
    data: {
      locationId: "l-east",
      requiredSkill: Skill.bartender,
      headcountNeeded: 1,
      startsAt: h(day(1), 10),
      endsAt:   h(day(1), 18), // 8 h → would push Marcus to 44 h → hard block
      published: false,
      createdBy: u.managerOlivia.id,
    },
  });

  // ── 7. Consecutive days scenario (Tom, 6-day streak) ──────────────
  //    Tom has shifts Mon → Sat; Sunday shift would trigger 7th-day override.
  const consecutiveDays = [-6, -5, -4, -3, -2, -1];
  for (const offset of consecutiveDays) {
    await prisma.shift.create({
      data: {
        locationId: "l-east",
        requiredSkill: Skill.line_cook,
        headcountNeeded: 1,
        startsAt: h(day(offset), 9),
        endsAt:   h(day(offset), 14),
        published: true,
        createdBy: u.managerOlivia.id,
        assignments: { create: [{ userId: u.tom.id }] },
      },
    });
  }

  // ── 8. Timezone Tangle: Alex works across both locations ───────────
  //    Alex has "9am–5pm" availability (stored as UTC-agnostic hours 9–17).
  //    Harbor View shift at 10am ET is fine (10am local).
  //    Pier Grill shift at 2pm PT is fine (14:00 local).
  await prisma.shift.create({
    data: {
      locationId: "l-east", // Harbor View (ET)
      requiredSkill: Skill.bartender,
      headcountNeeded: 1,
      startsAt: h(day(3), 15), // 15:00 UTC = 11am ET → within 9-17
      endsAt:   h(day(3), 21), // 17:00 ET
      published: true,
      createdBy: u.managerOlivia.id,
    },
  });
  await prisma.shift.create({
    data: {
      locationId: "l-west", // Pier Grill (PT)
      requiredSkill: Skill.bartender,
      headcountNeeded: 1,
      startsAt: h(day(4), 18), // 18:00 UTC = 10am PT → within 9-17
      endsAt:   h(day(4), 24), // 16:00 PT → fine for 9-17
      published: true,
      createdBy: u.managerDante.id,
    },
  });

  // ── 9. Pending SWAP request (Regret Swap scenario) ─────────────────
  const swapShift = await prisma.shift.create({
    data: {
      locationId: "l-east",
      requiredSkill: Skill.server,
      headcountNeeded: 1,
      startsAt: h(day(5), 17),
      endsAt:   h(day(5), 23),
      published: true,
      createdBy: u.managerOlivia.id,
      assignments: { create: [{ userId: u.sarah.id }] },
    },
  });
  await prisma.swapRequest.create({
    data: {
      shiftId:      swapShift.id,
      requesterId:  u.sarah.id,
      targetUserId: u.marcus.id, // Sarah wants to swap with Marcus
      type:         "SWAP",
      status:       "PENDING_PARTY_ACCEPTANCE", // Marcus has not yet accepted
    },
  });

  // ── 10. Historical shifts last week (for audit trail / fairness) ───
  const lastWeekShifts = [
    { userId: u.sarah.id,  skill: Skill.bartender, locId: "l-east", startH: 12, endH: 18 },
    { userId: u.marcus.id, skill: Skill.bartender, locId: "l-east", startH: 18, endH: 23 },
    { userId: u.nina.id,   skill: Skill.server,    locId: "l-west", startH: 10, endH: 16 },
    { userId: u.yuki.id,   skill: Skill.line_cook, locId: "l-west", startH: 14, endH: 22 },
  ];
  for (const s of lastWeekShifts) {
    await prisma.shift.create({
      data: {
        locationId:     s.locId,
        requiredSkill:  s.skill,
        headcountNeeded: 1,
        startsAt: h(lastWeekMon, s.startH),
        endsAt:   h(lastWeekMon, s.endH),
        published: true,
        createdBy: u.managerOlivia.id,
        assignments: { create: [{ userId: s.userId }] },
      },
    });
  }

  // ── 11. Pier Grill: Chloe's open drop (available to pick up) ──────
  const dropShift = await prisma.shift.create({
    data: {
      locationId: "l-west",
      requiredSkill: Skill.host,
      headcountNeeded: 1,
      startsAt: h(day(2), 17),
      endsAt:   h(day(2), 23),
      published: true,
      createdBy: u.managerDante.id,
      assignments: { create: [{ userId: u.chloe.id }] },
    },
  });
  await prisma.swapRequest.create({
    data: {
      shiftId:     dropShift.id,
      requesterId: u.chloe.id,
      type:        "DROP",
      status:      "PENDING_MANAGER_APPROVAL",
    },
  });

  // ── Audit log entries ──────────────────────────────────────────────
  await prisma.auditLog.createMany({
    data: [
      { actorId: u.managerOlivia.id, action: "SHIFT_CREATED",    after: JSON.parse(JSON.stringify({ shiftId: shift1.id,   locationId: "l-east", label: "Bartender shift today 4pm" })) },
      { actorId: u.managerDante.id,  action: "SHIFT_CREATED",    after: JSON.parse(JSON.stringify({ shiftId: shift2.id,   locationId: "l-west", label: "Overnight line_cook" })) },
      { actorId: u.managerOlivia.id, action: "SHIFT_ASSIGNED",   after: JSON.parse(JSON.stringify({ shiftId: shift1.id,   locationId: "l-east", assigneeId: u.sarah.id, assigneeName: "Sarah M" })) },
      { actorId: u.managerOlivia.id, action: "SHIFT_PUBLISHED",  after: JSON.parse(JSON.stringify({ shiftId: shift1.id,   locationId: "l-east" })) },
      { actorId: u.sarah.id,         action: "SWAP_CREATED",     after: JSON.parse(JSON.stringify({ shiftId: swapShift.id, locationId: "l-east", type: "SWAP" })) },
      { actorId: u.john.id,          action: "SWAP_CREATED",     after: JSON.parse(JSON.stringify({ shiftId: emergencyShift.id, locationId: "l-east", type: "DROP" })) },
    ],
  });

  console.log("  ✓ Shifts, swap requests, and audit logs created");
  console.log("    Edge cases covered:");
  console.log("      • Open slot (shift1: 1 of 2 assigned)");
  console.log("      • Overnight shift (Kofi, Pier Grill)");
  console.log("      • Emergency drop within 24h (John → immediate coverage needed)");
  console.log("      • Overtime Trap setup (Marcus at 36h — next assignment triggers block at 40h+)");
  console.log("      • Consecutive days streak (Tom, 6 days — 7th triggers override)");
  console.log("      • Timezone Tangle shifts (Alex, both locations, strict 9–17 availability)");
  console.log("      • Pending SWAP request awaiting acceptance (Sarah → Marcus)");
  console.log("      • Open DROP request available to qualified Pier Grill staff (Chloe)");
  console.log("      • Historical last-week shifts (audit trail / fairness data)");
}
