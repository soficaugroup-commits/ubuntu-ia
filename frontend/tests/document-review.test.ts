import { describe, expect, it } from "vitest";
import type { DocumentSpec } from "@/lib/server/document-spec";
import { reviewDeliverable } from "@/lib/server/document-review";

function spec(overrides: Partial<DocumentSpec> = {}): DocumentSpec {
  return {
    title: "Note interne",
    subtitle: "",
    charts: [],
    sections: [
      {
        title: "Résultats",
        body: ["Les filiales ont réalisé 1 200 FCFA de chiffre d'affaires."],
        bullets: [],
        table: {
          headers: ["Filiale", "Montant"],
          rows: [
            ["Abidjan", "400"],
            ["Dakar", "500"],
            ["Lomé", "300"],
            ["Total", "999"],
          ],
        },
      },
    ],
    ...overrides,
  };
}

describe("Relecture des totaux", () => {
  it("corrige un total de tableau faux", async () => {
    const { spec: next, report } = await reviewDeliverable({
      spec: spec(),
      question: "Rédige la note avec 400, 500 et 300.",
      excerpts: ["Abidjan 400, Dakar 500, Lomé 300."],
      citationCount: 1,
    });
    expect(next.sections[0].table?.rows[3][1]).toBe("1 200");
    expect(report.statut).toBe("corrige");
    expect(report.corrections[0]).toMatchObject({ type: "total", avant: "999", apres: "1 200" });
    expect(report.alertes).toEqual([]);
  });
});

describe("Relecture des chiffres et citations", () => {
  it("signale un chiffre absent des sources", async () => {
    const { spec: next, report } = await reviewDeliverable({
      spec: spec({
        sections: [
          {
            title: "Contexte",
            body: ["Le budget secret s'élève à 87 654 FCFA."],
            bullets: [],
          },
        ],
      }),
      question: "Rédige une note de contexte.",
      excerpts: ["Le comité s'est réuni le 12 mars 2026."],
      citationCount: 1,
    });
    expect(report.alertes.some((item) => item.type === "chiffre_non_source")).toBe(true);
    expect(report.statut).toBe("a_verifier");
    expect(next.sections[0].body[0]).toContain("[à confirmer]");
  });

  it("signale une citation [7] sans extrait 7", async () => {
    const { report } = await reviewDeliverable({
      spec: spec({
        sections: [
          {
            title: "Sources",
            body: ["La procédure interne impose un double visa [7]."],
            bullets: [],
          },
        ],
      }),
      question: "Rappelle la procédure.",
      excerpts: ["Visa du directeur.", "Visa du contrôleur."],
      citationCount: 2,
    });
    expect(report.alertes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "citation_manquante", extrait: "[7]" }),
      ]),
    );
  });
});
