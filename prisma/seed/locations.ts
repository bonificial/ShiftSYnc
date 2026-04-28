import { PrismaClient } from "@prisma/client";

export async function seedLocations(prisma: PrismaClient) {
  await prisma.location.createMany({
    data: [
      { id: "l-east", name: "Harbor View", timezone: "America/New_York" },
      { id: "l-west", name: "Pier Grill",  timezone: "America/Los_Angeles" },
    ],
  });
  console.log("  ✓ Locations created");
}
