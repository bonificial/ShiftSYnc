import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user || user.role !== "STAFF") {
    return NextResponse.json({ error: "Only staff can create exceptions" }, { status: 403 });
  }
  const prismaWithOptional = prisma as unknown as {
    availabilityException?: {
      create: (args: {
        data: {
          userId: string;
          date: Date;
          isOff: boolean;
          startHour: number | null;
          endHour: number | null;
        };
      }) => Promise<unknown>;
    };
  };
  if (!prismaWithOptional.availabilityException) {
    return NextResponse.json(
      { error: "Availability exceptions are unavailable. Run `npm run db:generate` and restart dev server." },
      { status: 503 },
    );
  }

  const body = await request.json();
  const date = new Date(String(body.date));
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const isOff = Boolean(body.isOff);
  const startHour = body.startHour === undefined ? null : Number(body.startHour);
  const endHour = body.endHour === undefined ? null : Number(body.endHour);
  if (!isOff && (startHour === null || endHour === null || startHour >= endHour)) {
    return NextResponse.json(
      { error: "Custom window exceptions require valid startHour and endHour" },
      { status: 400 },
    );
  }

  const exception = await prismaWithOptional.availabilityException.create({
    data: {
      userId: user.id,
      date,
      isOff,
      startHour: isOff ? null : startHour,
      endHour: isOff ? null : endHour,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "AVAILABILITY_EXCEPTION_CREATED",
      after: JSON.parse(JSON.stringify(exception)),
    },
  });

  return NextResponse.json({ exception });
}
