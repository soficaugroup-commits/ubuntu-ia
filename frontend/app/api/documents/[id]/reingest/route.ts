import { NextResponse } from "next/server";
import { IngestUserError, reingestDocument } from "@/lib/server/documents";
import { assertDocumentSecrets } from "@/lib/server/env";
import { withDocumentsClient } from "@/lib/server/supabase-admin";
import { isAdminActor, requireAdmin } from "@/lib/server/require-admin";

void process.env.OPENROUTER_API_KEY;
void process.env.OPENROUTER_BASE_URL;
void process.env.NETLIFY_AI_GATEWAY_KEY;
void process.env.NETLIFY_AI_GATEWAY_BASE_URL;

type Context = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, context: Context) {
  const configured = assertDocumentSecrets();
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 503 });
  }

  const actor = await requireAdmin(request);
  if (!isAdminActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  const { id } = await context.params;
  try {
    const document = await withDocumentsClient(request, () =>
      reingestDocument(id),
    );
    return NextResponse.json({ document });
  } catch (exc) {
    if (exc instanceof IngestUserError) {
      return NextResponse.json({ error: exc.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "L'indexation n'a pas pu être relancée." },
      { status: 500 },
    );
  }
}
