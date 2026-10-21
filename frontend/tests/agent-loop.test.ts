import { describe, expect, it } from "vitest";
import { planFromUnderstanding } from "@/lib/server/agent-loop/planner";
import { advanceTask, type TaskStore } from "@/lib/server/agent-loop/runner";
import { parsePlan, parseUnderstanding } from "@/lib/server/agent-loop/schema";
import { defaultTools } from "@/lib/server/agent-loop/tools/registry";
import type { AgentTask } from "@/lib/types";

function memoryStore(initial: AgentTask): TaskStore {
  const tasks = new Map<string, AgentTask>([[initial.id, structuredClone(initial)]]);
  const locks = new Set<string>();
  return {
    async load(id) {
      const row = tasks.get(id);
      return row ? structuredClone(row) : null;
    },
    async save(task) {
      tasks.set(task.id, structuredClone(task));
    },
    async claim(id) {
      if (locks.has(id)) return false;
      locks.add(id);
      return true;
    },
    async release(id) {
      locks.delete(id);
    },
  };
}

function seed(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "t1",
    userId: "u1",
    organisationId: null,
    conversationId: null,
    dossierId: null,
    titre: "Note d'achat",
    objectif: "Prépare une note Word puis un PowerPoint de 5 diapos.",
    statut: "cadrage",
    plan: [],
    contexte: {},
    etapeCourante: 0,
    budget: { maxEtapes: 8 },
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
    termineeAt: null,
    journal: [],
    ...overrides,
  };
}

describe("Schémas understand / planner", () => {
  it("rejette une compréhension sans objectif", () => {
    expect(parseUnderstanding({ livrables: ["note"] })).toBeNull();
    expect(parseUnderstanding({ objectif: "Rédiger la note", livrables: ["Word"] })?.objectif).toBe(
      "Rédiger la note",
    );
  });

  it("rejette un plan hors bornes ou au type inconnu", () => {
    expect(parsePlan({ etapes: [{ type: "chercher", description: "A" }] })).toBeNull();
    expect(
      parsePlan({
        etapes: [
          { type: "voler", description: "Interdit" },
          { type: "chercher", description: "A" },
          { type: "rediger", description: "B" },
        ],
      }),
    ).toBeNull();
    expect(planFromUnderstanding({
      objectif: "Note",
      livrables: ["Word"],
      contraintes: [],
      infos_manquantes: [],
      risques: [],
    }).length).toBeGreaterThanOrEqual(3);
  });
});

describe("Runner", () => {
  it("propose un plan puis s'arrête avant d'exécuter", async () => {
    const store = memoryStore(seed());
    const first = await advanceTask(store, "t1");
    expect(first.task.statut).toBe("plan_propose");
    expect(first.task.plan.length).toBeGreaterThanOrEqual(3);
    expect(first.events.some((event) => event.type === "tache_plan")).toBe(true);
    expect(first.task.plan.every((step) => step.statut === "a_faire")).toBe(true);
  });

  it("s'arrête sur une étape à valider et reprend après accord", async () => {
    const store = memoryStore(seed());
    await advanceTask(store, "t1");
    const loaded = await store.load("t1");
    loaded!.plan[0] = { ...loaded!.plan[0], necessiteValidation: true, statut: "a_faire" };
    loaded!.statut = "en_cours";
    await store.save(loaded!);

    const blocked = await advanceTask(store, "t1");
    expect(blocked.task.statut).toBe("en_attente_validation");
    expect(blocked.events.some((event) => event.type === "tache_validation_requise")).toBe(true);
    expect(blocked.task.plan[0].statut).toBe("bloquee");

    const waiting = await store.load("t1");
    waiting!.plan[0].sortie = { validee: true };
    waiting!.plan[0].statut = "a_faire";
    waiting!.statut = "en_cours";
    await store.save(waiting!);

    const resumed = await advanceTask(store, "t1", { budgetMs: 5_000 });
    expect(resumed.task.plan[0].statut).toBe("faite");
    expect(resumed.task.plan[0].tentatives).toBe(1);
  });

  it("respecte le budget et n'exécute pas deux fois une étape faite", async () => {
    const store = memoryStore(seed());
    await advanceTask(store, "t1");
    const ready = await store.load("t1");
    if (ready!.statut === "plan_propose") ready!.statut = "en_cours";
    ready!.plan = ready!.plan.map((step, index) => ({
      ...step,
      statut: index === 0 ? "faite" : "a_faire",
      tentatives: index === 0 ? 1 : 0,
    }));
    await store.save(ready!);

    const again = await advanceTask(store, "t1", { budgetMs: 50_000 });
    expect(again.task.plan[0].statut).toBe("faite");
    expect(again.task.plan[0].tentatives).toBe(1);
    expect(again.task.plan.some((step) => step.ordre > 1 && step.statut === "faite")).toBe(true);
  });
});
