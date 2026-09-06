import { NextResponse } from "next/server";
import { IngestUserError, reingestAllDocuments } from "@/lib/server/documents";
import { assertSupabaseSecrets } from "@/lib/server/env";
import { isAdminActor, requireAdmin } from "@/lib/server/require-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const configured = assertSupabaseSecrets();
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 503 });
  }

  const actor = await requireAdmin(request);
  if (!isAdminActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  try {
    const documents = await reingestAllDocuments();
    return NextResponse.json({ documents, count: documents.length });
  } catch (exc) {
    if (exc instanceof IngestUserError) {
      return NextResponse.json({ error: exc.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "La réindexation n'a pas pu démarrer." },
      { status: 500 },
    );
  }
}
