import { NextResponse } from "next/server";
import { copy } from "@/content/fr";
import { CategoryUserError, createCategory } from "@/lib/server/categories";
import { assertSupabaseSecrets } from "@/lib/server/env";
import { isAdminActor, requireAdmin } from "@/lib/server/require-admin";

export async function POST(request: Request) {
  const configured = assertSupabaseSecrets();
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 503 });
  }

  const actor = await requireAdmin(request);
  if (!isAdminActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  let body: { label?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  try {
    const category = await createCategory(body.label ?? "");
    return NextResponse.json({ category });
  } catch (exc) {
    if (exc instanceof CategoryUserError) {
      return NextResponse.json(
        { error: copy.admin.errors.category[exc.code], field: exc.code },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: copy.admin.errors.category.unavailable },
      { status: 500 },
    );
  }
}
