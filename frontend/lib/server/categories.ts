import { validateNewCategory } from "@/lib/categories";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import type { KnowledgeCategory, KnowledgeDocument } from "@/lib/types";

type CategoryRow = {
  id: string;
  label: string;
};

export function mergeDocumentCategories(
  categories: KnowledgeCategory[],
  documents: KnowledgeDocument[],
): KnowledgeCategory[] {
  const known = new Set(categories.map((item) => item.id));
  const extra = documents
    .map((document) => document.categorie)
    .filter((id): id is string => Boolean(id) && !known.has(id))
    .filter((id, index, list) => list.indexOf(id) === index)
    .map((id) => ({ id, label: id }));
  return [...categories, ...extra].sort((a, b) =>
    a.label.localeCompare(b.label, "fr"),
  );
}

export async function listCategories(): Promise<KnowledgeCategory[]> {
  const { data, error } = await supabaseAdmin()
    .from("document_categories")
    .select("id, label")
    .order("label");
  if (error) {
    throw new Error("Les catégories n'ont pas pu être chargées.");
  }
  return (data as CategoryRow[]).map((row) => ({ id: row.id, label: row.label }));
}

export async function createCategory(raw: string): Promise<KnowledgeCategory> {
  const existing = await listCategories();
  const parsed = validateNewCategory(raw, existing);
  if (!parsed.ok) {
    throw new CategoryUserError(parsed.code);
  }

  const { data, error } = await supabaseAdmin()
    .from("document_categories")
    .insert({ id: parsed.category.id, label: parsed.category.label })
    .select("id, label")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      throw new CategoryUserError("duplicate");
    }
    throw new Error("La catégorie n'a pas pu être enregistrée.");
  }

  return { id: data.id, label: data.label };
}

export class CategoryUserError extends Error {
  code: "required" | "invalid" | "duplicate";

  constructor(code: "required" | "invalid" | "duplicate") {
    super(code);
    this.name = "CategoryUserError";
    this.code = code;
  }
}
