import { PrismaClient, Role, Skill } from "@prisma/client";

const prisma = new PrismaClient();

const HARBOR_VIEW = "l-east";
const PIER_GRILL = "l-west";

const harborStaff = [
  { name: "Marcus Reid",   email: "marcus@shiftsync.local",   skills: [Skill.bartender, Skill.server],    desiredHours: 35 },
  { name: "Priya Nair",    email: "priya@shiftsync.local",    skills: [Skill.server, Skill.host],          desiredHours: 30 },
  { name: "Tom Fletcher",  email: "tom@shiftsync.local",      skills: [Skill.line_cook],                   desiredHours: 40 },
  { name: "Aisha Bakr",   email: "aisha@shiftsync.local",    skills: [Skill.bartender, Skill.host],       desiredHours: 32 },
  { name: "Leo Santos",   email: "leo@shiftsync.local",      skills: [Skill.line_cook, Skill.server],     desiredHours: 38 },
];

const pierStaff = [
  { name: "Nina Walsh",    email: "nina@shiftsync.local",     skills: [Skill.server, Skill.host],          desiredHours: 30 },
  { name: "Dante Cruz",   email: "dante@shiftsync.local",    skills: [Skill.bartender],                   desiredHours: 36 },
  { name: "Yuki Tanaka",  email: "yuki@shiftsync.local",     skills: [Skill.line_cook, Skill.server],     desiredHours: 40 },
  { name: "Chloe Evans",  email: "chloe@shiftsync.local",    skills: [Skill.host, Skill.bartender],       desiredHours: 28 },
  { name: "Kofi Mensah",  email: "kofi@shiftsync.local",     skills: [Skill.line_cook],                   desiredHours: 40 },
];

async function main() {
  const weekdays = [1, 2, 3, 4, 5];

  for (const person of harborStaff) {
    const existing = await prisma.user.findUnique({ where: { email: person.email } });
    if (existing) {
      console.log(`Skipping ${person.name} — already exists`);
      continue;
    }
    const user = await prisma.user.create({
      data: {
        name: person.name,
        email: person.email,
        password: "staff123",
        role: Role.STAFF,
        desiredHours: person.desiredHours,
      },
    });
    await prisma.certification.create({ data: { userId: user.id, locationId: HARBOR_VIEW } });
    await prisma.userSkill.createMany({
      data: person.skills.map((skill) => ({ userId: user.id, skill })),
    });
    await prisma.availabilityWindow.createMany({
      data: weekdays.map((dayOfWeek) => ({ userId: user.id, dayOfWeek, startHour: 8, endHour: 22 })),
    });
    console.log(`Created Harbor View staff: ${person.name}`);
  }

  for (const person of pierStaff) {
    const existing = await prisma.user.findUnique({ where: { email: person.email } });
    if (existing) {
      console.log(`Skipping ${person.name} — already exists`);
      continue;
    }
    const user = await prisma.user.create({
      data: {
        name: person.name,
        email: person.email,
        password: "staff123",
        role: Role.STAFF,
        desiredHours: person.desiredHours,
      },
    });
    await prisma.certification.create({ data: { userId: user.id, locationId: PIER_GRILL } });
    await prisma.userSkill.createMany({
      data: person.skills.map((skill) => ({ userId: user.id, skill })),
    });
    await prisma.availabilityWindow.createMany({
      data: weekdays.map((dayOfWeek) => ({ userId: user.id, dayOfWeek, startHour: 9, endHour: 21 })),
    });
    console.log(`Created Pier Grill staff: ${person.name}`);
  }

  console.log("\nDone. All staff added successfully.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
