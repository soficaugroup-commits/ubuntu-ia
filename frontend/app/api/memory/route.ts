/**
 * GET /api/memory
 * Liste les faits durables de l'utilisateur connecté (préférences, projets, habitudes).
 * Stockage plafonné (~20 faits) : au-delà, les plus anciens sont fusionnés en une synthèse.
 * Le prompt n'injecte qu'un budget borné (10 faits / ~1200 caractères).
 */
import { NextResponse } from "next/server";
import { assertDocumentSecrets } from "@/lib/server/env";
import { isSessionActor, requireUser } from "@/lib/server/require-admin";
import { listUserMemory } from "@/lib/server/user-memory";

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
    const facts = await listUserMemory(actor.id);
    return NextResponse.json(
      { facts },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "La mémoire n'a pas pu être chargée." },
      { status: 500 },
    );
  }
}
