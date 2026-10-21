/**
 * GET /api/modeles?format=docx|pptx|xlsx
 * Modèles actifs du groupe proposés dans le composeur (« Partir d'un modèle »).
 */
import { NextResponse } from "next/server";
import { assertDocumentSecrets } from "@/lib/server/env";
import { isSessionActor, requireUser } from "@/lib/server/require-admin";
import { withDocumentsClient } from "@/lib/server/supabase-admin";
import { listTemplatesForUser } from "@/lib/server/templates";
import type { TemplateFormat } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function asFormat(value: string | null): TemplateFormat | undefined {
  return value === "docx" || value === "pptx" || value === "xlsx" ? value : undefined;
}

export async function GET(request: Request) {
  const configured = assertDocumentSecrets();
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 503 });
  }
  const actor = await requireUser(request);
  if (!isSessionActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }
  const format = asFormat(new URL(request.url).searchParams.get("format"));
  try {
    const modeles = await withDocumentsClient(request, () => listTemplatesForUser(actor.id, format));
    return NextResponse.json(
      { modeles: modeles.map(({ id, nom, description, format: kind, categorie }) => ({ id, nom, description, format: kind, categorie })) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Les modèles n'ont pas pu être chargés." }, { status: 500 });
  }
}
