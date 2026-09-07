import { adminGet } from "@/lib/admin-api";
import { defaultCategories, mergeDocumentCategories } from "@/lib/categories";
import { supabaseBrowser } from "@/lib/supabase";
import type { KnowledgeCategory, KnowledgeDocument } from "@/lib/types";

export async function listKnowledgeFromSession(): Promise<
  | { ok: true; documents: KnowledgeDocument[]; categories: KnowledgeCategory[] }
  | { ok: false; error: string }
> {
  const fromApi = await adminGet<{
    documents: KnowledgeDocument[];
    categories: KnowledgeCategory[];
  }>("/api/documents");
  if (fromApi.ok && Array.isArray(fromApi.data.documents)) {
    return {
      ok: true,
      documents: fromApi.data.documents,
      categories: Array.isArray(fromApi.data.categories)
        ? fromApi.data.categories
        : mergeDocumentCategories(defaultCategories, fromApi.data.documents),
    };
  }

  const supabase = supabaseBrowser();
  if (!supabase) {
    return {
      ok: false,
      error: fromApi.ok === false ? fromApi.error : "Supabase n'est pas configuré.",
    };
  }

  const documentsResult = await supabase
    .from("documents")
    .select(
      "id, titre, categorie, type_source, url_source, date_ajout, statut_indexation, message_erreur",
    )
    .order("date_ajout", { ascending: false });

  if (documentsResult.error) {
    return {
      ok: false,
      error: fromApi.ok === false ? fromApi.error : documentsResult.error.message,
    };
  }

  const documents = (documentsResult.data ?? []).map((row) => ({
    id: row.id,
    titre: row.titre,
    categorie: row.categorie ?? "",
    type_source: row.type_source,
    url_source: row.url_source,
    date_ajout: row.date_ajout,
    statut_indexation: row.statut_indexation,
    message_erreur: row.message_erreur,
  })) as KnowledgeDocument[];

  const categoriesResult = await supabase
    .from("document_categories")
    .select("id, label")
    .order("label");

  const categories = mergeDocumentCategories(
    categoriesResult.error
      ? defaultCategories
      : (categoriesResult.data ?? []).map((row) => ({
          id: row.id,
          label: row.label,
        })),
    documents,
  );

  return { ok: true, documents, categories };
}
