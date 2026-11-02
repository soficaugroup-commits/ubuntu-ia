import { describe, expect, it } from "vitest";
import {
  extractOutline,
  formatMethodologyBrief,
  isMethodologyCategory,
  rankMethodologyDocuments,
  titleMatchScore,
  wantsMethodology,
} from "@/lib/server/methodology-logic";

describe("catégorie Méthodologie", () => {
  it("reconnaît les variantes de la catégorie", () => {
    expect(isMethodologyCategory("methodologie")).toBe(true);
    expect(isMethodologyCategory("Méthodologies")).toBe(true);
    expect(isMethodologyCategory("methodologie-audit")).toBe(true);
    expect(isMethodologyCategory("procedures")).toBe(false);
    expect(isMethodologyCategory(null)).toBe(false);
  });

  it("déclenche la méthodologie pour une rédaction structurée, pas pour une question simple", () => {
    expect(wantsMethodology("Rédige un rapport d'audit du projet ProCVA")).toBe(true);
    expect(wantsMethodology("Fais une comparaison des deux offres", { mode: "task" })).toBe(true);
    expect(wantsMethodology("Quelle est la procédure d'achat ?", { mode: "answer" })).toBe(false);
    expect(wantsMethodology("Bonjour", { mode: "answer" })).toBe(false);
    expect(wantsMethodology("n'importe quoi", { deliverable: true })).toBe(true);
  });
});

describe("choix de la référence", () => {
  const candidates = [
    { documentId: "bdo", titre: "Rapport d'audit BDO 2024", similarite: 0.41, hits: 3 },
    { documentId: "giz", titre: "Rapport d'avancement GIZ MOVE", similarite: 0.35, hits: 2 },
    { documentId: "ue", titre: "Trame évaluation Union européenne", similarite: 0.52, hits: 5 },
  ];

  it("priorise le document désigné par son sigle", () => {
    expect(titleMatchScore("un rapport pour la GIZ", "Rapport d'avancement GIZ MOVE")).toBeGreaterThan(0);
    const [first] = rankMethodologyDocuments("Rédige un rapport pour la GIZ", candidates, 1);
    expect(first.documentId).toBe("giz");
  });

  it("se rabat sur la similarité quand aucun titre n'est cité", () => {
    const [first] = rankMethodologyDocuments("Rédige une évaluation finale", candidates, 1);
    expect(first.documentId).toBe("ue");
  });

  it("ne retient rien sous le seuil de similarité", () => {
    const weak = candidates.map((item) => ({ ...item, similarite: 0.1 }));
    expect(rankMethodologyDocuments("Rédige une note", weak)).toEqual([]);
  });
});

describe("plan et consigne", () => {
  it("extrait les titres d'un rapport", () => {
    const text = [
      "RÉSUMÉ EXÉCUTIF",
      "Ce rapport présente les constats de la mission.",
      "1. Contexte et objectifs",
      "Le projet vise à renforcer la filière.",
      "2. Méthodologie",
      "II. Constats et analyse",
      "Recommandations",
      "Annexes",
    ].join("\n");
    expect(extractOutline(text)).toEqual([
      "RÉSUMÉ EXÉCUTIF",
      "1. Contexte et objectifs",
      "2. Méthodologie",
      "II. Constats et analyse",
      "Recommandations",
      "Annexes",
    ]);
  });

  it("interdit de citer la référence et de recopier ses faits", () => {
    const brief = formatMethodologyBrief([
      { documentId: "x", titre: "Rapport BDO", plan: ["Contexte", "Constats"], extraits: ["Texte"] },
    ]);
    expect(brief).toMatch(/NE JAMAIS CITER/);
    expect(brief).toMatch(/Ne recopie jamais les faits/);
    expect(brief).toMatch(/« Rapport BDO »/);
    expect(formatMethodologyBrief([])).toBe("");
  });
});
