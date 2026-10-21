/** POST /api/connecteurs/microsoft/revoquer — oublie les jetons Outlook. */
import { NextResponse } from "next/server";
import { revokeMicrosoft } from "@/lib/server/connectors/connexions";
import { isSessionActor, requireUser } from "@/lib/server/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await requireUser(request);
  if (!isSessionActor(actor)) return NextResponse.json({ error: actor.error }, { status: actor.status });
  try {
    await revokeMicrosoft(actor.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[outlook] révocation", error);
    return NextResponse.json({ error: "La déconnexion Outlook a échoué." }, { status: 500 });
  }
}
