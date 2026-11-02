/** Identifiant de la catégorie dont les documents structurent la rédaction sans jamais être cités. */
export const METHODOLOGY_CATEGORY = "methodologie";

/** Tolère les variantes saisies par un administrateur (« Méthodologies », « methodologie-audit »…). */
export function isMethodologyCategory(id: string | null | undefined): boolean {
  if (!id) return false;
  const slug = id
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return slug.startsWith("methodolog");
}
