import { NextResponse } from "next/server";
import {
  createFileDocument,
  createUrlDocument,
  IngestUserError,
  listDocuments,
} from "@/lib/server/documents";
import { listCategories, mergeDocumentCategories } from "@/lib/server/categories";
import { assertSupabaseSecrets } from "@/lib/server/env";
import { isAdminActor, requireAdmin } from "@/lib/server/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET(request: Request) {
  const configured = assertSupabaseSecrets();
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 503 });
  }

  const actor = await requireAdmin(request);
  if (!isAdminActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  try {
    const [documents, categories] = await Promise.all([
      listDocuments(),
      listCategories(),
    ]);
    return NextResponse.json(
      {
        documents,
        categories: mergeDocumentCategories(categories, documents),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "La liste des documents n'a pas pu être chargée." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const configured = assertSupabaseSecrets();
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 503 });
  }

  const actor = await requireAdmin(request);
  if (!isAdminActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const categorie = String(form.get("categorie") ?? "");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json(
          { error: "Choisissez un fichier à indexer." },
          { status: 400 },
        );
      }
      const document = await createFileDocument(file, categorie);
      return NextResponse.json({ document });
    }

    const body = (await request.json()) as { url?: string; categorie?: string };
    const url = body.url?.trim() ?? "";
    if (!url) {
      return NextResponse.json(
        { error: "Indiquez l'adresse complète de la page à indexer." },
        { status: 400 },
      );
    }
    const document = await createUrlDocument(url, body.categorie ?? "");
    return NextResponse.json({ document });
  } catch (exc) {
    if (exc instanceof IngestUserError) {
      return NextResponse.json({ error: exc.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "L'indexation n'a pas pu démarrer." },
      { status: 500 },
    );
  }
}
