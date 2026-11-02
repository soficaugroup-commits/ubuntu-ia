import "server-only";
import { embedTexts } from "@/lib/server/embed-texts";
import { matchIndexedChunks, organisationOf } from "@/lib/server/indexed-search";
import {
  extractOutline,
  formatMethodologyBrief,
  isMethodologyCategory,
  METHODOLOGY_CHAR_BUDGET,
  rankMethodologyDocuments,
  type MethodologyCandidate,
  type MethodologyReference,
} from "@/lib/server/methodology-logic";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export { formatMethodologyBrief, wantsMethodology } from "@/lib/server/methodology-logic";
export type { MethodologyReference } from "@/lib/server/methodology-logic";

const VECTOR_COUNT = 24;
const VECTOR_THRESHOLD = 0.25;
const MAX_REFERENCES = 2;
/** Segments lus par document pour reconstituer le plan (début du document). */
const OUTLINE_CHUNKS = 60;
/** Segments pertinents ajoutés en extraits. */
const RELEVANT_CHUNKS = 4;
/** Segments d'ouverture gardés pour le ton et la mise en forme. */
const OPENING_CHUNKS = 2;

type DocumentRow = { id: string; titre: string; categorie: string | null };
type ChunkRow = { contenu: string; position_document: number };

/**
 * Cherche, parmi les documents de la catégorie Méthodologie, la ou les références
 * de structure adaptées à la demande. Ne lève jamais : sans référence, renvoie [].
 */
export async function findMethodologyReferences(
  question: string,
  userId?: string | null,
): Promise<MethodologyReference[]> {
  try {
    const organisationId = await organisationOf(userId);
    const documents = await listMethodologyDocuments(organisationId);
    if (!documents.length) return [];

    const [vector] = await embedTexts([question]);
    const hits = await matchIndexedChunks(vector, {
      count: VECTOR_COUNT,
      threshold: VECTOR_THRESHOLD,
      organisationId,
      onlyMethodology: true,
    }).catch((error) => {
      console.error("[méthodologie] recherche", error);
      return [];
    });

    const byDocument = new Map<string, MethodologyCandidate & { positions: number[] }>();
    for (const doc of documents) {
      byDocument.set(doc.id, { documentId: doc.id, titre: doc.titre, similarite: 0, hits: 0, positions: [] });
    }
    for (const hit of hits) {
      const entry = byDocument.get(hit.document_id);
      if (!entry) continue;
      entry.similarite = Math.max(entry.similarite, hit.similarite);
      entry.hits += 1;
      if (typeof hit.position_document === "number") entry.positions.push(hit.position_document);
    }

    const chosen = rankMethodologyDocuments(question, [...byDocument.values()], MAX_REFERENCES);
    const references: MethodologyReference[] = [];
    for (const candidate of chosen) {
      const entry = byDocument.get(candidate.documentId);
      const reference = await buildReference(candidate, entry?.positions ?? []);
      if (reference) references.push(reference);
    }
    return references;
  } catch (error) {
    console.error("[méthodologie]", error);
    return [];
  }
}

/** Bloc système prêt à injecter, ou chaîne vide. */
export function methodologyPrompt(references: MethodologyReference[]): string {
  return formatMethodologyBrief(references);
}

async function listMethodologyDocuments(organisationId: string | null): Promise<DocumentRow[]> {
  let query = supabaseAdmin()
    .from("documents")
    .select("id, titre, categorie, organisation_id")
    .ilike("categorie", "methodolog%")
    .eq("statut_indexation", "termine")
    .limit(200);
  if (organisationId) {
    query = query.or(`organisation_id.is.null,organisation_id.eq.${organisationId}`);
  }
  const first = await query;
  let rows = first.data as DocumentRow[] | null;
  let error = first.error;
  if (error && /organisation_id/i.test(error.message ?? "")) {
    const retry = await supabaseAdmin()
      .from("documents")
      .select("id, titre, categorie")
      .ilike("categorie", "methodolog%")
      .eq("statut_indexation", "termine")
      .limit(200);
    rows = retry.data as DocumentRow[] | null;
    error = retry.error;
  }
  if (error) {
    console.error("[méthodologie] documents", error);
    return [];
  }
  return (rows ?? []).filter((row) => isMethodologyCategory(row.categorie));
}

async function buildReference(
  candidate: MethodologyCandidate,
  relevantPositions: number[],
): Promise<MethodologyReference | null> {
  const { data, error } = await supabaseAdmin()
    .from("document_chunks")
    .select("contenu, position_document")
    .eq("document_id", candidate.documentId)
    .order("position_document", { ascending: true })
    .limit(OUTLINE_CHUNKS);
  if (error) {
    console.error("[méthodologie] segments", error);
    return null;
  }
  const chunks = (data ?? []) as ChunkRow[];
  if (!chunks.length) return null;

  const plan = extractOutline(chunks.map((chunk) => chunk.contenu).join("\n"));
  const wanted = new Set<number>([
    ...chunks.slice(0, OPENING_CHUNKS).map((chunk) => chunk.position_document),
    ...relevantPositions.slice(0, RELEVANT_CHUNKS),
  ]);
  let extraits = chunks
    .filter((chunk) => wanted.has(chunk.position_document))
    .map((chunk) => chunk.contenu.trim())
    .filter(Boolean);

  // Segments pertinents situés au-delà des premiers segments chargés.
  const missing = relevantPositions
    .slice(0, RELEVANT_CHUNKS)
    .filter((position) => !chunks.some((chunk) => chunk.position_document === position));
  if (missing.length) {
    const extra = await supabaseAdmin()
      .from("document_chunks")
      .select("contenu, position_document")
      .eq("document_id", candidate.documentId)
      .in("position_document", missing);
    if (!extra.error) {
      extraits = extraits.concat(
        ((extra.data ?? []) as ChunkRow[]).map((chunk) => chunk.contenu.trim()).filter(Boolean),
      );
    }
  }

  let used = 0;
  const bounded: string[] = [];
  for (const text of extraits) {
    if (used + text.length > METHODOLOGY_CHAR_BUDGET) break;
    bounded.push(text);
    used += text.length;
  }
  return { documentId: candidate.documentId, titre: candidate.titre, plan, extraits: bounded };
}
