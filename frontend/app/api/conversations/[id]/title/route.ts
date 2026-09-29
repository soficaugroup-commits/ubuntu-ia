/**
 * POST /api/conversations/:id/title — titre automatique, sans bloquer le chat.
 */
import { NextResponse } from "next/server";
import { generateConversationTitle } from "@/lib/server/conversation-title";
import { applyGeneratedTitle } from "@/lib/server/conversations";
import { assertDocumentSecrets } from "@/lib/server/env";
import { isSessionActor, requireUser } from "@/lib/server/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const configured = assertDocumentSecrets();
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 503 });
  }

  const actor = await requireUser(request);
  if (!isSessionActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Conversation introuvable." }, { status: 404 });
  }

  let body: { question?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: true, title: null });
  }

  const question = String(body.question ?? "").trim();
  if (!question) return NextResponse.json({ ok: true, title: null });

  const generated = await generateConversationTitle(question);
  if (!generated) return NextResponse.json({ ok: true, title: null });

  const title = await applyGeneratedTitle(actor.id, id, generated);
  return NextResponse.json({ ok: true, title });
}
