import { after } from "next/server";
import {
  handleIncomingVapiWebhook,
  processAcceptedWebhookMessage,
} from "@/lib/server/vapi/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const result = await handleIncomingVapiWebhook({
    headers: request.headers,
    rawBody,
  });

  if (result.deferred) {
    after(async () => {
      await processAcceptedWebhookMessage(result.deferred!);
    });
  }

  if (result.body) {
    return Response.json(result.body, { status: result.status });
  }

  return new Response(null, { status: result.status });
}
