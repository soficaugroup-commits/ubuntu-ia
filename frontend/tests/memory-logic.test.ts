import { describe, expect, it } from "vitest";
import {
  formatGroupedFacts,
  isSensitiveMemory,
  parseMemoryOperations,
  scopeOf,
  selectFactsForPrompt,
  subjectMentioned,
  worthExtracting,
} from "@/lib/server/memory-logic";
import type { MemoryFact } from "@/lib/types";

function fact(partial: Partial<MemoryFact> & Pick<MemoryFact, "cle" | "valeur">): MemoryFact {
  return {
    id: partial.id ?? partial.cle,
    dateCreation: "2026-10-01T00:00:00Z",
    dateMaj: partial.dateMaj ?? "2026-10-01T00:00:00Z",
    ...partial,
  };
}

describe("lecture des opérations de mémoire", () => {
  it("garde les opérations valides et préfixe la clé par la portée", () => {
    const ops = parseMemoryOperations(
      '[{"action":"ajouter","cle":"echeance","valeur":"Livraison du rapport fin novembre.","portee":"projet","sujet":"GIZ MOVE","importance":3}]',
    );
    expect(ops).toEqual([
      {
        action: "ajouter",
        cle: "projet_echeance",
        valeur: "Livraison du rapport fin novembre.",
        portee: "projet",
        sujet: "GIZ MOVE",
        importance: 3,
      },
    ]);
  });

  it("refuse un fait de projet sans sujet, un fait sensible et un JSON invalide", () => {
    expect(parseMemoryOperations('[{"cle":"projet_x","valeur":"Budget validé","portee":"projet"}]')).toEqual([]);
    expect(
      parseMemoryOperations('[{"cle":"profil_sante","valeur":"Suit un traitement médical","portee":"profil"}]'),
    ).toEqual([]);
    expect(parseMemoryOperations("pas de json")).toEqual([]);
  });

  it("accepte un oubli sans valeur", () => {
    const [op] = parseMemoryOperations('[{"action":"oublier","cle":"preference_ton","portee":"preference"}]');
    expect(op.action).toBe("oublier");
    expect(op.cle).toBe("preference_ton");
  });
});

describe("séparation des souvenirs", () => {
  const facts = [
    fact({ cle: "preference_longueur", valeur: "Préfère des réponses courtes.", portee: "preference" }),
    fact({ cle: "profil_fonction", valeur: "Directeur général de NEXUS TECH AFRICA.", portee: "profil" }),
    fact({ cle: "projet_giz_echeance", valeur: "Rapport GIZ attendu fin novembre.", portee: "projet", sujet: "GIZ MOVE" }),
    fact({ cle: "projet_potalmen_cms", valeur: "Site POTALMEN sous WordPress.", portee: "projet", sujet: "POTALMEN" }),
  ];

  it("rappelle toujours préférences et profil, et seulement le projet concerné", () => {
    const { facts: chosen, text } = selectFactsForPrompt(facts, {
      question: "Prépare le rapport d'avancement pour la GIZ",
    });
    const keys = chosen.map((item) => item.cle);
    expect(keys).toContain("preference_longueur");
    expect(keys).toContain("profil_fonction");
    expect(keys).toContain("projet_giz_echeance");
    expect(keys).not.toContain("projet_potalmen_cms");
    expect(text).toMatch(/Projet « GIZ MOVE »/);
  });

  it("utilise la proximité sémantique quand le sujet n'est pas nommé", () => {
    const { facts: chosen } = selectFactsForPrompt(facts, {
      question: "Où en est le site web de l'ONG ?",
      similarIds: new Set(["projet_potalmen_cms"]),
    });
    expect(chosen.map((item) => item.cle)).toContain("projet_potalmen_cms");
  });

  it("reconnaît un sujet cité dans les échanges récents", () => {
    expect(subjectMentioned("GIZ MOVE", "et pour la giz ?")).toBe(true);
    expect(subjectMentioned("POTALMEN", "rapport GIZ")).toBe(false);
  });

  it("groupe le texte par rubrique", () => {
    const text = formatGroupedFacts(facts.slice(0, 2));
    expect(text).toMatch(/^Préférences de travail :/);
    expect(text).toMatch(/Profil :/);
  });

  it("déduit la portée des anciennes clés", () => {
    expect(scopeOf({ cle: "preference_ton" })).toBe("preference");
    expect(scopeOf({ cle: "resume" })).toBe("contexte");
  });
});

describe("garde-fous", () => {
  it("détecte les données sensibles", () => {
    expect(isSensitiveMemory("Mon mot de passe est 1234")).toBe(true);
    expect(isSensitiveMemory("Je préfère les rapports en Word")).toBe(false);
  });

  it("n'extrait rien d'un message trivial", () => {
    expect(worthExtracting("merci")).toBe(false);
    expect(worthExtracting("Je travaille sur le projet ProCVA avec la GIZ jusqu'en 2027")).toBe(true);
  });
});
