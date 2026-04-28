/**
 * ShiftSync — full realistic seed dataset.
 *
 * Run with:
 *   cd frontend && npm run db:seed
 *
 * IMPORTANT: This script DELETES all existing data first.
 * Use only against a development / staging database.
 */
import { PrismaClient } from "@prisma/client";
import { seedLocations } from "./locations";
import { seedUsers }     from "./users";
import { seedShifts }    from "./shifts";

const prisma = new PrismaClient();

async function main() {
  console.log("ShiftSync seed starting…");

  // Wipe in dependency order
  console.log("  Clearing existing data…");
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

  await seedLocations(prisma);
  const users = await seedUsers(prisma);
  await seedShifts(prisma, users);

  console.log("\nSeed complete. Summary:");
  console.log("  Locations : 2  (Harbor View · Pier Grill)");
  console.log("  Users     : 15 (1 admin · 2 managers · 12 staff)");
  console.log("  Shifts    : 18+ with edge cases (see shifts.ts)");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
