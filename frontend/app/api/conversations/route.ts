import { NextResponse } from "next/server";
import { listUserConversations } from "@/lib/server/conversations";
import { assertDocumentSecrets } from "@/lib/server/env";
import { isSessionActor, requireUser } from "@/lib/server/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const configured = assertDocumentSecrets();
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 503 });
  }

  const actor = await requireUser(request);
  if (!isSessionActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  try {
    const conversations = await listUserConversations(actor.id);
    return NextResponse.json(
      { conversations },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "L'historique n'a pas pu être chargé." },
      { status: 500 },
    );
  }
}
