import { describe, expect, it } from "vitest";
import { isTaskStatus, mapStep, mapTask, STEP_TYPES, TASK_STATUSES } from "@/lib/server/tasks";

describe("Modèle de tâches", () => {
  it("accepte uniquement les statuts prévus", () => {
    expect(TASK_STATUSES).toHaveLength(8);
    expect(isTaskStatus("en_cours")).toBe(true);
    expect(isTaskStatus("en_attente_validation")).toBe(true);
    expect(isTaskStatus("running")).toBe(false);
  });

  it("mappe une ligne SQL vers une tâche", () => {
    const task = mapTask({
      id: "t1",
      user_id: "u1",
      organisation_id: null,
      conversation_id: "c1",
      dossier_id: null,
      titre: "Note d'achat",
      objectif: "Rédiger une note puis un diaporama.",
      statut: "cadrage",
      plan: [{ type: "chercher", description: "Lire la procédure" }],
      contexte: { faits: ["Procédure d'achat indexée"] },
      etape_courante: 0,
      budget: { maxEtapes: 8 },
      created_at: "2026-10-21T00:00:00.000Z",
      updated_at: "2026-10-21T00:00:00.000Z",
      terminee_at: null,
    });
    expect(task.titre).toBe("Note d'achat");
    expect(task.plan[0]?.type).toBe("chercher");
    expect(task.contexte.faits).toEqual(["Procédure d'achat indexée"]);
    expect(task.budget.maxEtapes).toBe(8);
  });

  it("mappe une étape avec validation requise", () => {
    const step = mapStep({
      id: "e1",
      ordre: 6,
      type: "agir",
      description: "Envoyer la note",
      statut: "bloquee",
      entree: {},
      sortie: {},
      necessite_validation: true,
      tentatives: 0,
      started_at: null,
      finished_at: null,
      erreur: null,
    });
    expect(step.necessiteValidation).toBe(true);
    expect(STEP_TYPES).toContain(step.type);
  });
});
