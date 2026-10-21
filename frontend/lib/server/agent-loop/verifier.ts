import { reviewDeliverable } from "@/lib/server/document-review";
import type { DocumentSpec } from "@/lib/server/document-spec";
import type { ReviewReport } from "@/lib/types";

const BLOCKING = new Set(["chiffre_non_source", "citation_manquante", "fait_non_etaye"]);

export function isBlockingReview(report: ReviewReport): boolean {
  return report.alertes.some((alert) => BLOCKING.has(alert.type));
}

/** Après rédiger / livrer : relit la spec ; une alerte bloquante déclenche une étape corriger. */
export async function verifyDeliverableSpec(
  spec: DocumentSpec,
  question: string,
  excerpts: string[],
  citationCount: number,
): Promise<ReviewReport> {
  const { report } = await reviewDeliverable({ spec, question, excerpts, citationCount });
  return report;
}
