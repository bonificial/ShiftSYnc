import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { addClient, removeClient } from "@/lib/broadcast";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = crypto.randomUUID();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      addClient(clientId, user.id, controller);
      // Initial ping so the browser EventSource knows it's alive
      controller.enqueue(encoder.encode(": connected\n\n"));

      // Heartbeat every 25s to prevent proxy timeouts
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(heartbeat);
          removeClient(clientId);
        }
      }, 25000);

      // Attach cleanup to the controller so it runs on close
      (controller as unknown as Record<string, unknown>).__heartbeat = heartbeat;
    },
    cancel(controller) {
      const hb = (controller as unknown as Record<string, unknown>).__heartbeat;
      if (hb) clearInterval(hb as ReturnType<typeof setInterval>);
      removeClient(clientId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
