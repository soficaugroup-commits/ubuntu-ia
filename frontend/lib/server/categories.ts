import {
  defaultCategories,
  mergeDocumentCategories,
  validateNewCategory,
} from "@/lib/categories";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import type { KnowledgeCategory } from "@/lib/types";

export { mergeDocumentCategories };

type CategoryRow = {
  id: string;
  label: string;
};

export async function listCategories(): Promise<KnowledgeCategory[]> {
  const { data, error } = await supabaseAdmin()
    .from("document_categories")
    .select("id, label")
    .order("label");
  if (error) {
    return defaultCategories;
  }
  const rows = (data as CategoryRow[]).map((row) => ({
    id: row.id,
    label: row.label,
  }));
  return rows.length ? rows : defaultCategories;
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
