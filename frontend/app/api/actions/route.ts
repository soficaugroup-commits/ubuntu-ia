/** GET /api/actions — actions proposées de l'utilisateur, sans les jetons. */
import { NextResponse } from "next/server";
import { listProposedForUser } from "@/lib/server/connectors/proposed-actions";
import { isSessionActor, requireUser } from "@/lib/server/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await requireUser(request);
  if (!isSessionActor(actor)) return NextResponse.json({ error: actor.error }, { status: actor.status });
  try {
    const actions = await listProposedForUser(actor.id);
    return NextResponse.json({ actions }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[actions]", error);
    return NextResponse.json({ error: "Les actions n'ont pas pu être chargées." }, { status: 500 });
  }
}
