import { z } from "zod";
import { startDemoSession } from "@/lib/server/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const demoStartSchema = z.object({
  transport: z.enum(["web", "pstn"]),
  targetNumber: z.string().trim().min(1).optional(),
  label: z.string().trim().max(120).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const body = demoStartSchema.parse(await request.json());

    if (body.transport === "pstn" && !body.targetNumber) {
      return Response.json(
        { error: "targetNumber is required for PSTN demo calls." },
        { status: 400 }
      );
    }

    const result = await startDemoSession(body);
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error: "Invalid demo start payload.",
          issues: error.issues,
        },
        { status: 400 }
      );
    }

    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to start demo session.",
      },
      { status: 500 }
    );
  }
}
