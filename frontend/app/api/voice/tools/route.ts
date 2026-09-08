import { NextResponse } from "next/server";
import { assertDocumentSecrets, assertRealtimeSecrets } from "@/lib/server/env";
import { isSessionActor, requireUser } from "@/lib/server/require-admin";
import { runVoiceTool } from "@/lib/server/voice-tools";

void process.env.OPENROUTER_API_KEY;
void process.env.CHAT_MODEL;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const ALLOWED = new Set(["search_documents", "think_deeper"]);

export async function POST(request: Request) {
  const configured = assertDocumentSecrets() || assertRealtimeSecrets();
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 503 });
  }

  const actor = await requireUser(request);
  if (!isSessionActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  let body: { name?: string; arguments?: Record<string, unknown> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "L'outil n'a pas pu être lu." }, { status: 400 });
  }

  const name = body.name?.trim() ?? "";
  if (!ALLOWED.has(name)) {
    return NextResponse.json({ error: "Outil inconnu." }, { status: 400 });
  }

  try {
    const output = await runVoiceTool(name, body.arguments ?? {});
    return NextResponse.json(
      { output },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[voice] tool", name, error);
    return NextResponse.json(
      { output: "L'outil n'a pas pu aboutir. Dis-le simplement à l'utilisateur." },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
