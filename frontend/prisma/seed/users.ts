import { PrismaClient, Role, Skill } from "@prisma/client";

// All demo passwords are "staff123" for staff, "manager123" for managers, "admin123" for admin.

export type SeededUsers = {
  admin: { id: string };
  managerOlivia: { id: string };
  managerDante: { id: string };
  // Harbor View staff
  sarah: { id: string };
  john: { id: string };
  marcus: { id: string };
  priya: { id: string };
  tom: { id: string };
  aisha: { id: string };
  leo: { id: string };
  // Pier Grill staff
  nina: { id: string };
  yuki: { id: string };
  chloe: { id: string };
  kofi: { id: string };
  // Cross-location staff (certified at both)
  alex: { id: string };
};

export async function seedUsers(prisma: PrismaClient): Promise<SeededUsers> {
  const [
    admin, managerOlivia, managerDante,
    sarah, john, marcus, priya, tom, aisha, leo,
    nina, yuki, chloe, kofi,
    alex,
  ] = await Promise.all([
    prisma.user.create({ data: { name: "Admin Jane",      email: "admin@shiftsync.local",   password: "admin123",   role: Role.ADMIN,   desiredHours: 40 } }),
    prisma.user.create({ data: { name: "Olivia Manager",  email: "manager@shiftsync.local",  password: "manager123", role: Role.MANAGER, desiredHours: 40 } }),
    prisma.user.create({ data: { name: "Dante Cruz",      email: "dante@shiftsync.local",    password: "manager123", role: Role.MANAGER, desiredHours: 40 } }),

    // Harbor View staff
    prisma.user.create({ data: { name: "Sarah M",        email: "sarah@shiftsync.local",    password: "staff123",   role: Role.STAFF,   desiredHours: 32 } }),
    prisma.user.create({ data: { name: "John K",         email: "john@shiftsync.local",     password: "staff123",   role: Role.STAFF,   desiredHours: 30 } }),
    prisma.user.create({ data: { name: "Marcus Reid",    email: "marcus@shiftsync.local",   password: "staff123",   role: Role.STAFF,   desiredHours: 35 } }),
    prisma.user.create({ data: { name: "Priya Nair",     email: "priya@shiftsync.local",    password: "staff123",   role: Role.STAFF,   desiredHours: 30 } }),
    prisma.user.create({ data: { name: "Tom Fletcher",   email: "tom@shiftsync.local",      password: "staff123",   role: Role.STAFF,   desiredHours: 40 } }),
    prisma.user.create({ data: { name: "Aisha Bakr",     email: "aisha@shiftsync.local",    password: "staff123",   role: Role.STAFF,   desiredHours: 32 } }),
    prisma.user.create({ data: { name: "Leo Santos",     email: "leo@shiftsync.local",      password: "staff123",   role: Role.STAFF,   desiredHours: 38 } }),

    // Pier Grill staff
    prisma.user.create({ data: { name: "Nina Walsh",     email: "nina@shiftsync.local",     password: "staff123",   role: Role.STAFF,   desiredHours: 30 } }),
    prisma.user.create({ data: { name: "Yuki Tanaka",    email: "yuki@shiftsync.local",     password: "staff123",   role: Role.STAFF,   desiredHours: 40 } }),
    prisma.user.create({ data: { name: "Chloe Evans",    email: "chloe@shiftsync.local",    password: "staff123",   role: Role.STAFF,   desiredHours: 28 } }),
    prisma.user.create({ data: { name: "Kofi Mensah",    email: "kofi@shiftsync.local",     password: "staff123",   role: Role.STAFF,   desiredHours: 40 } }),

    // Cross-location (both) — used in Timezone Tangle scenario
    prisma.user.create({ data: { name: "Alex Rivera",    email: "alex@shiftsync.local",     password: "staff123",   role: Role.STAFF,   desiredHours: 36 } }),
  ]);

  // Certifications
  await prisma.certification.createMany({
    data: [
      // Admin & managers
      { userId: admin.id,          locationId: "l-east" },
      { userId: admin.id,          locationId: "l-west" },
      { userId: managerOlivia.id,  locationId: "l-east" },
      { userId: managerOlivia.id,  locationId: "l-west" },
      { userId: managerDante.id,   locationId: "l-west" },

      // Harbor View staff
      { userId: sarah.id,   locationId: "l-east" },
      { userId: sarah.id,   locationId: "l-west" }, // cross-location
      { userId: john.id,    locationId: "l-east" },
      { userId: marcus.id,  locationId: "l-east" },
      { userId: priya.id,   locationId: "l-east" },
      { userId: tom.id,     locationId: "l-east" },
      { userId: aisha.id,   locationId: "l-east" },
      { userId: leo.id,     locationId: "l-east" },

      // Pier Grill staff
      { userId: nina.id,    locationId: "l-west" },
      { userId: yuki.id,    locationId: "l-west" },
      { userId: chloe.id,   locationId: "l-west" },
      { userId: kofi.id,    locationId: "l-west" },

      // Cross-location (Timezone Tangle scenario)
      { userId: alex.id,    locationId: "l-east" },
      { userId: alex.id,    locationId: "l-west" },
    ],
  });

  // Skills
  await prisma.userSkill.createMany({
    data: [
      // Harbor View
      { userId: sarah.id,   skill: Skill.bartender },
      { userId: sarah.id,   skill: Skill.server },
      { userId: john.id,    skill: Skill.bartender },
      { userId: john.id,    skill: Skill.host },
      { userId: marcus.id,  skill: Skill.bartender },
      { userId: marcus.id,  skill: Skill.server },
      { userId: priya.id,   skill: Skill.server },
      { userId: priya.id,   skill: Skill.host },
      { userId: tom.id,     skill: Skill.line_cook },
      { userId: aisha.id,   skill: Skill.bartender },
      { userId: aisha.id,   skill: Skill.host },
      { userId: leo.id,     skill: Skill.line_cook },
      { userId: leo.id,     skill: Skill.server },

      // Pier Grill
      { userId: nina.id,    skill: Skill.server },
      { userId: nina.id,    skill: Skill.host },
      { userId: yuki.id,    skill: Skill.line_cook },
      { userId: yuki.id,    skill: Skill.server },
      { userId: chloe.id,   skill: Skill.host },
      { userId: chloe.id,   skill: Skill.bartender },
      { userId: kofi.id,    skill: Skill.line_cook },

      // Cross-location Alex: bartender + server at both
      { userId: alex.id,    skill: Skill.bartender },
      { userId: alex.id,    skill: Skill.server },
    ],
  });

  // Availability windows (stored as location-local hours, 0=Sun, 6=Sat)
  const harborIds = [sarah.id, john.id, marcus.id, priya.id, tom.id, aisha.id, leo.id];
  const pierIds   = [nina.id, yuki.id, chloe.id, kofi.id];

  const harborWindows = harborIds.flatMap((userId) =>
    [1, 2, 3, 4, 5].map((d) => ({ userId, dayOfWeek: d, startHour: 8, endHour: 22 })),
  );
  const pierWindows = pierIds.flatMap((userId) =>
    [1, 2, 3, 4, 5].map((d) => ({ userId, dayOfWeek: d, startHour: 9, endHour: 21 })),
  );
  // Alex: strict 9–17 to demonstrate Timezone Tangle scenario
  const alexWindows = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    userId: alex.id, dayOfWeek: d, startHour: 9, endHour: 17,
  }));

  await prisma.availabilityWindow.createMany({
    data: [...harborWindows, ...pierWindows, ...alexWindows],
  });

  console.log("  ✓ Users, certifications, skills, and availability windows created");
  return { admin, managerOlivia, managerDante, sarah, john, marcus, priya, tom, aisha, leo, nina, yuki, chloe, kofi, alex };
}
