import { NextResponse } from "next/server";
import { deleteStoredDocument, IngestUserError } from "@/lib/server/documents";
import { assertSupabaseSecrets } from "@/lib/server/env";
import { isAdminActor, requireAdmin } from "@/lib/server/require-admin";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context) {
  const configured = assertSupabaseSecrets();
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 503 });
  }

  const actor = await requireAdmin(request);
  if (!isAdminActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  const { id } = await context.params;
  try {
    const document = await deleteStoredDocument(id);
    return NextResponse.json({ document });
  } catch (exc) {
    if (exc instanceof IngestUserError) {
      return NextResponse.json({ error: exc.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Le document n'a pas pu être supprimé." },
      { status: 500 },
    );
  }
}
