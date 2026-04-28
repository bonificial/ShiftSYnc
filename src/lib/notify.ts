import { prisma } from "@/lib/prisma";
import { broadcast } from "@/lib/broadcast";

type NotifyInput = {
  userId: string;
  title: string;
  body: string;
};

/**
 * Central notification helper.
 * - Creates in-app notification(s) in the DB.
 * - If the recipient's pref is IN_APP_EMAIL, sets emailed=true on the record
 *   (simulating an outbound email — the UI renders a badge showing the email address).
 * - Broadcasts a real-time SSE event so the recipient's tab updates instantly.
 */
export async function notify(input: NotifyInput | NotifyInput[]): Promise<void> {
  const inputs = Array.isArray(input) ? input : [input];
  if (inputs.length === 0) return;

  const userIds = [...new Set(inputs.map((i) => i.userId))];

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, notifPref: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  const data = inputs.map((i) => ({
    userId: i.userId,
    title: i.title,
    body: i.body,
    emailed: userMap.get(i.userId)?.notifPref === "IN_APP_EMAIL",
  }));

  await prisma.notification.createMany({ data });

  for (const uid of userIds) {
    broadcast("new_notification", {}, uid);
  }
}
