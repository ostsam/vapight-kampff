import { z } from "zod";
import { executeOperatorAction } from "@/lib/server/actions";
import { isOperatorAuthorized } from "@/lib/server/security/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const operatorActionSchema = z.object({
  action: z.enum([
    "force-human",
    "force-ai",
    "next-trap",
    "transfer-now",
    "end-call",
  ]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!isOperatorAuthorized(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = operatorActionSchema.parse(await request.json());
    const result = await executeOperatorAction(id, body.action);

    return Response.json(result, {
      status: result.status === "applied" ? 200 : result.status === "queued" ? 202 : 502,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid operator action payload.", issues: error.issues },
        { status: 400 }
      );
    }

    if (error instanceof Error) {
      if (error.message === "Session not found.") {
        return Response.json({ error: error.message }, { status: 404 });
      }

      if (error.message === "Cannot control a completed call.") {
        return Response.json({ error: error.message }, { status: 409 });
      }

      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ error: "Unknown operator action failure." }, { status: 500 });
  }
}
