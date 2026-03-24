import {
  decodeRedisJson,
  getLiveSnapshot,
  subscribeToLiveEvents,
} from "@/lib/server/live/store";
import { getDb } from "@/lib/server/db/client";
import { findSessionById } from "@/lib/server/db/repositories";
import { snapshotFromSession } from "@/lib/server/coordinator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function encodeSseChunk(event: string, payload: unknown): Uint8Array {
  const text = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  return new TextEncoder().encode(text);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const { sessionId } = await params;
  const cachedSnapshot = await getLiveSnapshot(sessionId);
  const session = cachedSnapshot
    ? null
    : await findSessionById(getDb(), sessionId);

  if (!cachedSnapshot && !session) {
    return Response.json({ error: "Live session not found." }, { status: 404 });
  }

  const initialSnapshot = cachedSnapshot ?? snapshotFromSession(session!);
  const subscriber = subscribeToLiveEvents(sessionId);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encodeSseChunk("session.snapshot", initialSnapshot));

      const keepalive = setInterval(() => {
        controller.enqueue(new TextEncoder().encode(": ping\n\n"));
      }, 15_000);

      const handleMessage = ({ message }: { message: unknown }) => {
        const decoded = decodeRedisJson<{ event: string; data: unknown }>(message);
        if (!decoded) {
          return;
        }

        controller.enqueue(encodeSseChunk(decoded.event, decoded.data));
      };

      const handleError = (error: Error) => {
        controller.enqueue(
          encodeSseChunk("error", {
            message: error.message,
          })
        );
        controller.close();
      };

      subscriber.on("message", handleMessage);
      subscriber.on("error", handleError);

      const cleanup = async () => {
        clearInterval(keepalive);
        subscriber.removeAllListeners();
        try {
          await subscriber.unsubscribe();
        } catch {
          // Ignore teardown failures.
        }
        controller.close();
      };

      request.signal.addEventListener("abort", () => {
        void cleanup();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
