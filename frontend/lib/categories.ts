import { copy } from "@/content/fr";
import type { KnowledgeCategory } from "@/lib/types";

export const ALL_CATEGORIES = "all";

export const defaultCategories: KnowledgeCategory[] = (
  Object.entries(copy.categories) as [string, string][]
).map(([id, label]) => ({ id, label }));

export function slugifyCategory(label: string): string {
  return label
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function categoryLabel(
  id: string,
  categories: KnowledgeCategory[],
): string {
  return categories.find((item) => item.id === id)?.label ?? id;
}

export function parseCategoryLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function validateNewCategory(
  raw: string,
  categories: KnowledgeCategory[],
):
  | { ok: true; category: KnowledgeCategory }
  | { ok: false; code: "required" | "invalid" | "duplicate" } {
  const label = parseCategoryLabel(raw);
  if (!label) return { ok: false, code: "required" };

  const id = slugifyCategory(label);
  if (!id || id === ALL_CATEGORIES) return { ok: false, code: "invalid" };

  const exists = categories.some(
    (item) =>
      item.id === id || item.label.localeCompare(label, "fr", { sensitivity: "accent" }) === 0,
  );
  if (exists) return { ok: false, code: "duplicate" };

  return { ok: true, category: { id, label } };
}
