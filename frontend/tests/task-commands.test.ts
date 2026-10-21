import { describe, expect, it } from "vitest";
import { acceptPlan, answerTask, approveStep, cancelTask, replacePlan } from "@/lib/server/agent-loop/commands";
import { isTaskStreamEvent } from "@/lib/chat-stream-events";
import type { AgentTask } from "@/lib/types";

function task(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "u1",
    organisationId: null,
    conversationId: null,
    dossierId: null,
    titre: "Note",
    objectif: "Rédiger",
    statut: "plan_propose",
    plan: [1, 2, 3].map((ordre) => ({
      id: `s${ordre}`,
      ordre,
      type: ordre === 3 ? "agir" : "chercher",
      description: `Étape ${ordre}`,
      statut: "a_faire" as const,
      entree: {},
      sortie: {},
      necessiteValidation: ordre === 3,
      tentatives: 0,
    })),
    contexte: {},
    etapeCourante: 0,
    budget: {},
    createdAt: "",
    updatedAt: "",
    termineeAt: null,
    journal: [],
    ...overrides,
  };
}

describe("Commandes de tâche", () => {
  it("valide un plan proposé et refuse un second accord", () => {
    const accepted = acceptPlan(task());
    expect(accepted.ok && accepted.task.statut).toBe("en_cours");
    if (!accepted.ok) return;
    expect(acceptPlan(accepted.task).ok).toBe(false);
  });

  it("remplace le plan et rejette une liste trop courte", () => {
    expect(replacePlan(task(), [{ type: "chercher", description: "Seul" }]).ok).toBe(false);
    const next = replacePlan(task(), [
      { type: "lire", description: "Lire la procédure" },
      { type: "rediger", description: "Rédiger la note" },
      { type: "livrer", description: "Produire le Word" },
    ]);
    expect(next.ok && next.task.plan.map((step) => step.type)).toEqual(["lire", "rediger", "livrer"]);
  });

  it("enregistre une réponse puis reprend", () => {
    const waiting = task({ statut: "en_attente_utilisateur" });
    waiting.plan[0].statut = "bloquee";
    waiting.plan[0].type = "demander";
    const answered = answerTask(waiting, "Le destinataire est la direction financière.");
    expect(answered.ok && answered.task.statut).toBe("en_cours");
    if (!answered.ok) return;
    expect(answered.task.contexte.faits).toContain("Le destinataire est la direction financière.");
    expect(answered.task.journal?.some((entry) => entry.type === "reponse")).toBe(true);
  });

  it("valide une étape bloquée et annule la tâche", () => {
    const blocked = task({ statut: "en_attente_validation" });
    blocked.plan[2].statut = "bloquee";
    const approved = approveStep(blocked, 3);
    expect(approved.ok && approved.task.plan[2].sortie.validee).toBe(true);
    expect(approved.ok && approved.task.statut).toBe("en_cours");
    const cancelled = cancelTask(task({ statut: "en_cours" }));
    expect(cancelled.ok && cancelled.task.statut).toBe("annulee");
  });
});

describe("Événements de tâche", () => {
  it("reconnaît les événements SSE du lot B", () => {
    expect(isTaskStreamEvent({ type: "tache_question", question: "Quel destinataire ?" })).toBe(true);
    expect(isTaskStreamEvent({ type: "token", content: "x" })).toBe(false);
  });
});
