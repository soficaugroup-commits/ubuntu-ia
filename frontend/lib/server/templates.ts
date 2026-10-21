import "server-only";
import { officeWorkerEnabled } from "@/lib/server/office-validate";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { analyzeTemplate } from "@/lib/server/template-fill";
import type { DocumentTemplate, TemplateField, TemplateFormat } from "@/lib/types";

export { matchTemplate } from "@/lib/server/template-match";

export const TEMPLATES_BUCKET = "modeles-documents";
export const TEMPLATE_MAX_BYTES = 25 * 1024 * 1024;

const COLUMNS =
  "id, organisation_id, nom, description, format, categorie, storage_path, champs, structure, apercu_path, actif, created_at, updated_at";

type TemplateRow = {
  id: string;
  organisation_id: string | null;
  nom: string;
  description: string;
  format: TemplateFormat;
  categorie: string | null;
  storage_path: string;
  champs: TemplateField[] | null;
  structure: DocumentTemplate["structure"] | null;
  apercu_path: string | null;
  actif: boolean;
  created_at: string;
  updated_at: string;
};

export class TemplateUserError extends Error {}

const MIME: Record<TemplateFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function templateFormatOf(name: string): TemplateFormat | null {
  const ext = name.toLowerCase().split(".").pop();
  return ext === "docx" || ext === "pptx" || ext === "xlsx" ? ext : null;
}

function mapTemplate(row: TemplateRow, apercuUrl?: string | null): DocumentTemplate {
  return {
    id: row.id,
    nom: row.nom,
    description: row.description,
    format: row.format,
    categorie: row.categorie,
    champs: Array.isArray(row.champs) ? row.champs : [],
    structure: row.structure ?? {},
    actif: row.actif,
    apercuUrl: apercuUrl ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function organisationOf(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin().from("users").select("organisation_id").eq("id", userId).maybeSingle();
  return (data?.organisation_id as string | null | undefined) ?? null;
}

/** Modèles actifs visibles par un utilisateur : ceux de son organisation et ceux du groupe (sans organisation). */
export async function listTemplatesForUser(userId: string, format?: TemplateFormat): Promise<DocumentTemplate[]> {
  const organisationId = await organisationOf(userId);
  let query = supabaseAdmin().from("modeles_documents").select(COLUMNS).eq("actif", true).order("nom");
  query = organisationId
    ? query.or(`organisation_id.is.null,organisation_id.eq.${organisationId}`)
    : query.is("organisation_id", null);
  if (format) query = query.eq("format", format);
  const { data, error } = await query;
  if (error) {
    console.error("[templates] liste", error.message);
    throw new Error("Les modèles n'ont pas pu être chargés.");
  }
  return (data as TemplateRow[]).map((row) => mapTemplate(row));
}

/** Tous les modèles de l'organisation de l'administrateur (actifs ou non), avec aperçu signé. */
export async function listTemplatesForAdmin(adminId: string): Promise<DocumentTemplate[]> {
  const organisationId = await organisationOf(adminId);
  let query = supabaseAdmin().from("modeles_documents").select(COLUMNS).order("updated_at", { ascending: false });
  query = organisationId
    ? query.or(`organisation_id.is.null,organisation_id.eq.${organisationId}`)
    : query.is("organisation_id", null);
  const { data, error } = await query;
  if (error) {
    console.error("[templates] liste admin", error.message);
    throw new Error("Les modèles n'ont pas pu être chargés.");
  }
  const rows = data as TemplateRow[];
  return Promise.all(rows.map(async (row) => mapTemplate(row, await previewUrl(row))));
}

async function previewUrl(row: TemplateRow): Promise<string | null> {
  const client = supabaseAdmin();
  let path = row.apercu_path;
  if (!path && row.format === "pptx" && officeWorkerEnabled()) {
    const { data } = await client
      .from("office_jobs")
      .select("result")
      .eq("kind", "pptx_thumbnails")
      .eq("status", "done")
      .eq("payload->>modele_id", row.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const thumbs = (data?.result as { thumbnails?: unknown } | null)?.thumbnails;
    const first = Array.isArray(thumbs) && typeof thumbs[0] === "string" ? thumbs[0] : null;
    if (first) {
      path = first;
      await client.from("modeles_documents").update({ apercu_path: first }).eq("id", row.id);
    }
  }
  if (!path) return null;
  const signed = await client.storage.from(TEMPLATES_BUCKET).createSignedUrl(path, 60 * 60);
  return signed.data?.signedUrl ?? null;
}

export async function createTemplate(
  file: File,
  input: { nom: string; description: string; categorie: string | null },
  adminId: string,
): Promise<DocumentTemplate> {
  const format = templateFormatOf(file.name);
  if (!format) throw new TemplateUserError("Seuls les modèles Word (.docx), PowerPoint (.pptx) et Excel (.xlsx) sont acceptés.");
  if (file.size > TEMPLATE_MAX_BYTES) throw new TemplateUserError("Le modèle dépasse 25 Mo.");
  const bytes = Buffer.from(await file.arrayBuffer());
  let analysis;
  try {
    analysis = await analyzeTemplate(format, bytes);
  } catch (error) {
    console.error("[templates] analyse", error);
    throw new TemplateUserError("Le fichier n'a pas pu être lu comme un modèle Office. Vérifiez qu'il s'ouvre dans Office.");
  }
  const organisationId = await organisationOf(adminId);
  const id = crypto.randomUUID();
  const path = `${organisationId ?? "groupe"}/${id}.${format}`;
  const client = supabaseAdmin();
  const upload = await client.storage.from(TEMPLATES_BUCKET).upload(path, bytes, { contentType: MIME[format], upsert: false });
  if (upload.error) {
    console.error("[templates] stockage", upload.error.message);
    throw new Error("Le modèle n'a pas pu être enregistré.");
  }
  const nom = input.nom.trim() || file.name.replace(/\.[^.]+$/, "");
  const { data, error } = await client
    .from("modeles_documents")
    .insert({
      id,
      organisation_id: organisationId,
      nom: nom.slice(0, 160),
      description: input.description.trim(),
      format,
      categorie: input.categorie || null,
      storage_path: path,
      champs: analysis.champs,
      structure: analysis.structure,
      cree_par: adminId,
    })
    .select(COLUMNS)
    .single();
  if (error || !data) {
    console.error("[templates] insertion", error?.message);
    await client.storage.from(TEMPLATES_BUCKET).remove([path]);
    throw new Error("Le modèle n'a pas pu être enregistré.");
  }
  if (format === "pptx" && officeWorkerEnabled()) {
    const job = await client.from("office_jobs").insert({
      user_id: adminId,
      kind: "pptx_thumbnails",
      input_path: path,
      status: "queued",
      payload: { source: "modele", bucket: TEMPLATES_BUCKET, modele_id: id, format },
    });
    if (job.error) console.error("[templates] office_jobs", job.error.message);
  }
  return mapTemplate(data as TemplateRow);
}

async function adminRow(adminId: string, id: string): Promise<TemplateRow> {
  const organisationId = await organisationOf(adminId);
  const { data } = await supabaseAdmin().from("modeles_documents").select(COLUMNS).eq("id", id).maybeSingle();
  const row = data as TemplateRow | null;
  if (!row || (row.organisation_id && row.organisation_id !== organisationId)) {
    throw new TemplateUserError("Modèle introuvable.");
  }
  return row;
}

export async function updateTemplate(
  adminId: string,
  id: string,
  patch: { nom?: string; description?: string; categorie?: string | null; actif?: boolean },
): Promise<DocumentTemplate> {
  await adminRow(adminId, id);
  const changes: Record<string, unknown> = {};
  if (typeof patch.nom === "string") {
    const nom = patch.nom.trim();
    if (!nom) throw new TemplateUserError("Le nom du modèle est obligatoire.");
    changes.nom = nom.slice(0, 160);
  }
  if (typeof patch.description === "string") changes.description = patch.description.trim();
  if (patch.categorie !== undefined) changes.categorie = patch.categorie || null;
  if (typeof patch.actif === "boolean") changes.actif = patch.actif;
  const { data, error } = await supabaseAdmin().from("modeles_documents").update(changes).eq("id", id).select(COLUMNS).single();
  if (error || !data) {
    console.error("[templates] mise à jour", error?.message);
    throw new Error("Le modèle n'a pas pu être mis à jour.");
  }
  return mapTemplate(data as TemplateRow);
}

export async function deleteTemplate(adminId: string, id: string): Promise<void> {
  const row = await adminRow(adminId, id);
  const client = supabaseAdmin();
  const { error } = await client.from("modeles_documents").delete().eq("id", id);
  if (error) {
    console.error("[templates] suppression", error.message);
    throw new Error("Le modèle n'a pas pu être supprimé.");
  }
  const paths = [row.storage_path, row.apercu_path].filter((item): item is string => Boolean(item));
  const removed = await client.storage.from(TEMPLATES_BUCKET).remove(paths);
  if (removed.error) console.error("[templates] suppression fichier", removed.error.message);
}

export type LoadedTemplate = { template: DocumentTemplate; bytes: Buffer };

/** Charge un modèle actif accessible à l'utilisateur (même organisation ou modèle du groupe). */
export async function loadTemplateForUser(userId: string, id: string): Promise<LoadedTemplate | null> {
  const organisationId = await organisationOf(userId);
  const client = supabaseAdmin();
  const { data } = await client.from("modeles_documents").select(COLUMNS).eq("id", id).eq("actif", true).maybeSingle();
  const row = data as TemplateRow | null;
  if (!row || (row.organisation_id && row.organisation_id !== organisationId)) return null;
  const file = await client.storage.from(TEMPLATES_BUCKET).download(row.storage_path);
  if (file.error || !file.data) {
    console.error("[templates] téléchargement", file.error?.message);
    return null;
  }
  return { template: mapTemplate(row), bytes: Buffer.from(await file.data.arrayBuffer()) };
}

const FORMAT_NAME: Record<TemplateFormat, string> = { docx: "Word", pptx: "PowerPoint", xlsx: "Excel" };

/** Consigne ajoutée au prompt système quand le livrable part d'un modèle du groupe. */
export function templatePromptBrief(template: DocumentTemplate): string {
  const simple = template.champs.filter((field) => field.type === "texte" || field.type === "nom_defini");
  const rows = template.champs.filter((field) => field.type === "boucle" || field.type === "tableau");
  const lines = [
    `MODÈLE IMPOSÉ : le livrable ${FORMAT_NAME[template.format]} part du modèle officiel « ${template.nom} »${
      template.description ? ` (${template.description})` : ""
    }. La mise en page, les logos et les styles viennent du modèle : tu fournis uniquement le contenu.`,
  ];
  if (template.structure.titres?.length) {
    lines.push(
      `Rédige des sections dont les titres reprennent exactement ceux du modèle quand ils s'appliquent : ${template.structure.titres
        .slice(0, 20)
        .join(" ; ")}.`,
    );
  }
  if (simple.length || rows.length) {
    const example: Record<string, unknown> = {};
    if (simple.length) example.champs = Object.fromEntries(simple.map((field) => [field.nom, "…"]));
    if (rows.length) {
      example.lignes = Object.fromEntries(
        rows.map((field) => [field.nom, [Object.fromEntries((field.colonnes ?? []).map((column) => [column, "…"]))]]),
      );
    }
    lines.push(
      `Termine ta réponse par un bloc \`\`\`ubuntu-ia-doc contenant les valeurs des champs du modèle, au format : ${JSON.stringify(example)}.`,
      "N'invente aucune valeur (montant, référence, nom, date d'échéance) : si l'information manque, mets une chaîne vide, le livrable affichera « [à compléter : champ] ».",
    );
  }
  return lines.join("\n");
}

