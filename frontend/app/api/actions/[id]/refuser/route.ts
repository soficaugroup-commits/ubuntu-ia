/** POST /api/actions/:id/refuser */
import { NextResponse } from "next/server";
import { reviewStoredAction } from "@/lib/server/connectors/proposed-actions";
import { isSessionActor, requireUser } from "@/lib/server/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await requireUser(request);
  if (!isSessionActor(actor)) return NextResponse.json({ error: actor.error }, { status: actor.status });
  const { id } = await context.params;
  const result = await reviewStoredAction(actor.id, id, "refuser");
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
