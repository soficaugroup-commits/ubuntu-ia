import "server-only";
import { isMethodologyCategory, METHODOLOGY_CATEGORY } from "@/lib/server/methodology-logic";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

/** Ligne renvoyée par les fonctions SQL match_document_chunks*. */
export type IndexedChunkRow = {
  id?: string;
  document_id: string;
  contenu: string;
  position_document?: number;
  titre: string;
  categorie?: string | null;
  type_source: "fichier" | "url";
  url_source: string | null;
  similarite: number;
};

export type IndexedSearchOptions = {
  count: number;
  threshold: number;
  organisationId?: string | null;
  /** Ne garder que ces catégories (recherche méthodologique). */
  onlyMethodology?: boolean;
};

/** Facteur de sur-échantillonnage quand on doit filtrer côté serveur Node (migration 019 absente). */
const FALLBACK_OVERSAMPLE = 4;

let filteredRpcMissing = false;

/**
 * Recherche vectorielle dans la base indexée.
 * Par défaut, les documents de la catégorie Méthodologie sont EXCLUS : ils ne servent
 * qu'à structurer la rédaction et ne doivent jamais apparaître comme sources.
 */
export async function matchIndexedChunks(
  vector: number[],
  options: IndexedSearchOptions,
): Promise<IndexedChunkRow[]> {
  const client = supabaseAdmin();
  const methodology = [METHODOLOGY_CATEGORY];

  if (!filteredRpcMissing) {
    const { data, error } = await client.rpc("match_document_chunks_filtered", {
      query_embedding: vector,
      match_count: options.count,
      match_threshold: options.threshold,
      organisation_id: options.organisationId ?? null,
      include_categories: options.onlyMethodology ? methodology : null,
      exclude_categories: options.onlyMethodology ? null : methodology,
    });
    if (!error) return cleanRows(data, options);
    if (isMissingFunction(error)) {
      filteredRpcMissing = true;
      console.error("[recherche] migration 019 absente : repli sur match_document_chunks");
    } else {
      throw new Error(
        `La recherche dans les documents indexés a échoué${error.message ? ` : ${error.message}` : "."}`,
      );
    }
  }

  const oversampled = options.count * FALLBACK_OVERSAMPLE;
  const scoped = options.organisationId
    ? await client.rpc("match_document_chunks_scoped", {
        query_embedding: vector,
        match_count: oversampled,
        match_threshold: options.threshold,
        organisation_id: options.organisationId,
      })
    : null;
  const result =
    scoped && !scoped.error
      ? scoped
      : await client.rpc("match_document_chunks", {
          query_embedding: vector,
          match_count: oversampled,
          match_threshold: options.threshold,
        });
  if (result.error) {
    throw new Error(
      `La recherche dans les documents indexés a échoué${result.error.message ? ` : ${result.error.message}` : "."}`,
    );
  }
  return cleanRows(result.data, options).slice(0, options.count);
}

/** organisation_id de l'utilisateur, ou null. */
export async function organisationOf(userId?: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabaseAdmin()
    .from("users")
    .select("organisation_id")
    .eq("id", userId)
    .maybeSingle();
  return (data?.organisation_id as string | null | undefined) ?? null;
}

function cleanRows(data: unknown, options: IndexedSearchOptions): IndexedChunkRow[] {
  const rows = (Array.isArray(data) ? data : []) as IndexedChunkRow[];
  return rows
    .filter((row) => row.contenu?.trim() && (row.similarite ?? 0) >= options.threshold)
    .filter((row) =>
      options.onlyMethodology
        ? isMethodologyCategory(row.categorie)
        : !isMethodologyCategory(row.categorie),
    )
    .map((row) => ({
      ...row,
      type_source: row.type_source === "url" ? "url" : "fichier",
      url_source: row.url_source ?? null,
    }));
}

function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /could not find the function|does not exist/i.test(error.message ?? "")
  );
}
