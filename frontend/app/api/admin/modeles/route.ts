/**
 * Modèles de documents du groupe (administrateurs).
 * GET    /api/admin/modeles            liste + catégories
 * POST   /api/admin/modeles            multipart : file, nom, description, categorie
 * PATCH  /api/admin/modeles?id=…       JSON : nom, description, categorie, actif
 * DELETE /api/admin/modeles?id=…
 */
import { NextResponse } from "next/server";
import { listCategories } from "@/lib/server/categories";
import { assertDocumentSecrets } from "@/lib/server/env";
import { isAdminActor, requireAdmin, type AdminActor } from "@/lib/server/require-admin";
import { withDocumentsClient } from "@/lib/server/supabase-admin";
import {
  createTemplate,
  deleteTemplate,
  listTemplatesForAdmin,
  TemplateUserError,
  updateTemplate,
} from "@/lib/server/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

async function guard(request: Request): Promise<AdminActor | NextResponse> {
  const configured = assertDocumentSecrets();
  if (configured) return NextResponse.json({ error: configured }, { status: 503 });
  const actor = await requireAdmin(request);
  if (!isAdminActor(actor)) return NextResponse.json({ error: actor.error }, { status: actor.status });
  return actor;
}

function failure(error: unknown, fallback: string): NextResponse {
  if (error instanceof TemplateUserError) return NextResponse.json({ error: error.message }, { status: 400 });
  console.error("[admin/modeles]", error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

function idFrom(request: Request): string {
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  return /^[0-9a-f-]{36}$/i.test(id) ? id : "";
}

export async function GET(request: Request) {
  const actor = await guard(request);
  if (actor instanceof NextResponse) return actor;
  try {
    const [modeles, categories] = await withDocumentsClient(request, () =>
      Promise.all([listTemplatesForAdmin(actor.id), listCategories()]),
    );
    return NextResponse.json({ modeles, categories }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error, "Les modèles n'ont pas pu être chargés.");
  }
}

export async function POST(request: Request) {
  const actor = await guard(request);
  if (actor instanceof NextResponse) return actor;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Choisissez un fichier Word, PowerPoint ou Excel." }, { status: 400 });
    }
    const modele = await withDocumentsClient(request, () =>
      createTemplate(
        file,
        {
          nom: String(form.get("nom") ?? ""),
          description: String(form.get("description") ?? ""),
          categorie: String(form.get("categorie") ?? "") || null,
        },
        actor.id,
      ),
    );
    return NextResponse.json({ modele });
  } catch (error) {
    return failure(error, "Le modèle n'a pas pu être enregistré.");
  }
}

export async function PATCH(request: Request) {
  const actor = await guard(request);
  if (actor instanceof NextResponse) return actor;
  const id = idFrom(request);
  if (!id) return NextResponse.json({ error: "Modèle introuvable." }, { status: 400 });
  try {
    const body = (await request.json()) as {
      nom?: unknown;
      description?: unknown;
      categorie?: unknown;
      actif?: unknown;
    };
    const modele = await withDocumentsClient(request, () =>
      updateTemplate(actor.id, id, {
        nom: typeof body.nom === "string" ? body.nom : undefined,
        description: typeof body.description === "string" ? body.description : undefined,
        categorie: typeof body.categorie === "string" || body.categorie === null ? body.categorie : undefined,
        actif: typeof body.actif === "boolean" ? body.actif : undefined,
      }),
    );
    return NextResponse.json({ modele });
  } catch (error) {
    return failure(error, "Le modèle n'a pas pu être mis à jour.");
  }
}

export async function DELETE(request: Request) {
  const actor = await guard(request);
  if (actor instanceof NextResponse) return actor;
  const id = idFrom(request);
  if (!id) return NextResponse.json({ error: "Modèle introuvable." }, { status: 400 });
  try {
    await withDocumentsClient(request, () => deleteTemplate(actor.id, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error, "Le modèle n'a pas pu être supprimé.");
  }
}
