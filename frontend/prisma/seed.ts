import { PrismaClient, Role, Skill } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.session.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.swapRequest.deleteMany();
  await prisma.shiftAssignment.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.availabilityException.deleteMany();
  await prisma.availabilityWindow.deleteMany();
  await prisma.userSkill.deleteMany();
  await prisma.certification.deleteMany();
  await prisma.user.deleteMany();
  await prisma.location.deleteMany();

  await prisma.location.createMany({
    data: [
      { id: "l-east", name: "Harbor View", timezone: "America/New_York" },
      { id: "l-west", name: "Pier Grill", timezone: "America/Los_Angeles" },
    ],
  });

  const admin = await prisma.user.create({
    data: {
      name: "Admin Jane",
      email: "admin@shiftsync.local",
      password: "admin123",
      role: Role.ADMIN,
      desiredHours: 40,
    },
  });
  const manager = await prisma.user.create({
    data: {
      name: "Olivia Manager",
      email: "manager@shiftsync.local",
      password: "manager123",
      role: Role.MANAGER,
      desiredHours: 40,
    },
  });
  const staff1 = await prisma.user.create({
    data: {
      name: "Sarah M",
      email: "sarah@shiftsync.local",
      password: "staff123",
      role: Role.STAFF,
      desiredHours: 32,
    },
  });
  const staff2 = await prisma.user.create({
    data: {
      name: "John K",
      email: "john@shiftsync.local",
      password: "staff123",
      role: Role.STAFF,
      desiredHours: 30,
    },
  });

  await prisma.certification.createMany({
    data: [
      { userId: admin.id, locationId: "l-east" },
      { userId: admin.id, locationId: "l-west" },
      { userId: manager.id, locationId: "l-east" },
      { userId: manager.id, locationId: "l-west" },
      { userId: staff1.id, locationId: "l-east" },
      { userId: staff1.id, locationId: "l-west" },
      { userId: staff2.id, locationId: "l-east" },
    ],
  });

  await prisma.userSkill.createMany({
    data: [
      { userId: staff1.id, skill: Skill.bartender },
      { userId: staff1.id, skill: Skill.server },
      { userId: staff2.id, skill: Skill.bartender },
      { userId: staff2.id, skill: Skill.host },
    ],
  });

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  await prisma.availabilityWindow.createMany({
    data: [
      { userId: staff1.id, dayOfWeek: 1, startHour: 8, endHour: 23 },
      { userId: staff1.id, dayOfWeek: 2, startHour: 8, endHour: 23 },
      { userId: staff1.id, dayOfWeek: 3, startHour: 8, endHour: 23 },
      { userId: staff1.id, dayOfWeek: 4, startHour: 8, endHour: 23 },
      { userId: staff1.id, dayOfWeek: 5, startHour: 8, endHour: 23 },
      { userId: staff2.id, dayOfWeek: 2, startHour: 9, endHour: 18 },
    ],
  });

  const offDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);
  await prisma.availabilityException.create({
    data: { userId: staff1.id, date: offDate, isOff: true },
  });
  const s1Start = new Date(today.getTime() + 16 * 3600000);
  const s1End = new Date(today.getTime() + 23 * 3600000);
  const s2Start = new Date(today.getTime() + 18 * 3600000);
  const s2End = new Date(today.getTime() + 26 * 3600000);

  const shift1 = await prisma.shift.create({
    data: {
      locationId: "l-east",
      requiredSkill: Skill.bartender,
      headcountNeeded: 1,
      startsAt: s1Start,
      endsAt: s1End,
      createdBy: manager.id,
      assignments: {
        create: [{ userId: staff1.id }],
      },
    },
  });
  await prisma.shift.create({
    data: {
      locationId: "l-west",
      requiredSkill: Skill.line_cook,
      headcountNeeded: 1,
      startsAt: s2Start,
      endsAt: s2End,
      createdBy: manager.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: manager.id,
      action: "SEED_SHIFT_CREATED",
      after: { shiftId: shift1.id },
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
