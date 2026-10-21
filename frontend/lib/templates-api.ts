import { supabaseBrowser } from "@/lib/supabase";
import type { DocumentTemplate, KnowledgeCategory, TemplateFormat } from "@/lib/types";

export type TemplateOption = Pick<DocumentTemplate, "id" | "nom" | "description" | "format" | "categorie">;

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = supabaseBrowser();
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readBody<T>(response: Response): Promise<T & { error?: string }> {
  return (await response.json().catch(() => ({}))) as T & { error?: string };
}

export async function loadTemplateOptions(format?: TemplateFormat): Promise<Result<{ modeles: TemplateOption[] }>> {
  const response = await fetch(`/api/modeles${format ? `?format=${format}` : ""}`, {
    cache: "no-store",
    headers: await authHeaders(),
  });
  const body = await readBody<{ modeles?: TemplateOption[] }>(response);
  if (!response.ok) return { ok: false, error: body.error || "Les modèles n'ont pas pu être chargés." };
  return { ok: true, modeles: body.modeles ?? [] };
}

export async function loadAdminTemplates(): Promise<
  Result<{ modeles: DocumentTemplate[]; categories: KnowledgeCategory[] }>
> {
  const response = await fetch("/api/admin/modeles", { cache: "no-store", headers: await authHeaders() });
  const body = await readBody<{ modeles?: DocumentTemplate[]; categories?: KnowledgeCategory[] }>(response);
  if (!response.ok) return { ok: false, error: body.error || "Les modèles n'ont pas pu être chargés." };
  return { ok: true, modeles: body.modeles ?? [], categories: body.categories ?? [] };
}

export async function uploadTemplate(input: {
  file: File;
  nom: string;
  description: string;
  categorie: string;
}): Promise<Result<{ modele: DocumentTemplate }>> {
  const form = new FormData();
  form.set("file", input.file);
  form.set("nom", input.nom);
  form.set("description", input.description);
  form.set("categorie", input.categorie);
  const response = await fetch("/api/admin/modeles", {
    method: "POST",
    body: form,
    cache: "no-store",
    headers: await authHeaders(),
  });
  const body = await readBody<{ modele?: DocumentTemplate }>(response);
  if (!response.ok || !body.modele) return { ok: false, error: body.error || "Le modèle n'a pas pu être enregistré." };
  return { ok: true, modele: body.modele };
}

export async function updateTemplate(
  id: string,
  patch: { nom?: string; description?: string; categorie?: string | null; actif?: boolean },
): Promise<Result<{ modele: DocumentTemplate }>> {
  const response = await fetch(`/api/admin/modeles?id=${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(patch),
    cache: "no-store",
  });
  const body = await readBody<{ modele?: DocumentTemplate }>(response);
  if (!response.ok || !body.modele) return { ok: false, error: body.error || "Le modèle n'a pas pu être mis à jour." };
  return { ok: true, modele: body.modele };
}

export async function removeTemplate(id: string): Promise<Result<object>> {
  const response = await fetch(`/api/admin/modeles?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    cache: "no-store",
    headers: await authHeaders(),
  });
  const body = await readBody<object>(response);
  if (!response.ok) return { ok: false, error: body.error || "Le modèle n'a pas pu être supprimé." };
  return { ok: true };
}
