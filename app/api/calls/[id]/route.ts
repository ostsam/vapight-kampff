import { getDb } from "@/lib/server/db/client";
import { getReplay } from "@/lib/server/db/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const replay = await getReplay(getDb(), id);

  if (!replay.session) {
    return Response.json({ error: "Call session not found." }, { status: 404 });
  }

  return Response.json(replay, { status: 200 });
}
