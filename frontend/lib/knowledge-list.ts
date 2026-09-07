import { mergeDocumentCategories } from "@/lib/categories";
import { supabaseBrowser } from "@/lib/supabase";
import type { KnowledgeCategory, KnowledgeDocument } from "@/lib/types";

export async function listKnowledgeFromSession(): Promise<
  | { ok: true; documents: KnowledgeDocument[]; categories: KnowledgeCategory[] }
  | { ok: false }
> {
  const supabase = supabaseBrowser();
  if (!supabase) return { ok: false };

  const [documentsResult, categoriesResult] = await Promise.all([
    supabase
      .from("documents")
      .select(
        "id, titre, categorie, type_source, url_source, date_ajout, statut_indexation, message_erreur",
      )
      .order("date_ajout", { ascending: false }),
    supabase.from("document_categories").select("id, label").order("label"),
  ]);

  if (documentsResult.error || categoriesResult.error) {
    return { ok: false };
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

  const categories = mergeDocumentCategories(
    (categoriesResult.data ?? []).map((row) => ({
      id: row.id,
      label: row.label,
    })),
    documents,
  );

  return { ok: true, documents, categories };
}
