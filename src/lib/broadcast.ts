/**
 * In-memory SSE client registry.
 * Works for single-process deployments (local dev, single Vercel instance).
 * For multi-instance production, replace with Redis pub/sub.
 */

type Client = {
  userId: string;
  controller: ReadableStreamDefaultController;
};

const clients = new Map<string, Client>();

export function addClient(
  id: string,
  userId: string,
  controller: ReadableStreamDefaultController,
) {
  clients.set(id, { userId, controller });
}

export function removeClient(id: string) {
  clients.delete(id);
}

/**
 * Broadcast an SSE event to all connected clients.
 * If targetUserId is provided, only that user's connections receive it.
 */
export function broadcast(
  event: "shift_update" | "swap_update" | "new_notification" | "on_duty_update",
  data: Record<string, unknown> = {},
  targetUserId?: string,
) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoded = new TextEncoder().encode(payload);
  for (const [id, client] of clients) {
    if (targetUserId && client.userId !== targetUserId) continue;
    try {
      client.controller.enqueue(encoded);
    } catch {
      clients.delete(id);
    }
  }
}

export function clientCount() {
  return clients.size;
}
