import { describe, expect, it } from "vitest";
import { planFromUnderstanding } from "@/lib/server/agent-loop/planner";
import { advanceTask, type TaskStore } from "@/lib/server/agent-loop/runner";
import { parsePlan, parseUnderstanding } from "@/lib/server/agent-loop/schema";
import { draftFromContext, formatOf } from "@/lib/server/agent-loop/task-brief";
import { defaultTools } from "@/lib/server/agent-loop/tools/registry";
import { understandFromQuestion } from "@/lib/server/agent-loop/understand";
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

const SCENARIO =
  "Prépare une note de synthèse Word sur la procédure d'achat à partir des documents internes, puis un PowerPoint de 5 diapos";

describe("Scénario note puis diaporama", () => {
  it("propose deux livrables puis les marque prêts dans le journal", async () => {
    const understood = understandFromQuestion(SCENARIO);
    expect(understood.livrables).toEqual(["une note Word", "un diaporama PowerPoint"]);
    expect(planFromUnderstanding(understood).map((step) => step.type)).toEqual([
      "chercher",
      "lire",
      "rediger",
      "verifier",
      "livrer",
      "livrer",
    ]);
    expect(formatOf("Produire un diaporama PowerPoint.")).toBe("pptx");
    expect(draftFromContext("Note", [])).toContain("Aucun extrait interne");

    const store = memoryStore(seed({ titre: "Procédure d'achat", objectif: SCENARIO }));
    const tools = defaultTools([
      {
        name: "build_deliverable",
        description: "Livrable simulé pour le scénario.",
        risk: "ecriture",
        async run(_args, ctx) {
          const name = ctx.step.description.includes("PowerPoint") ? "procedure.pptx" : "procedure.docx";
          ctx.task.contexte.fichiers = [...(ctx.task.contexte.fichiers ?? []), name];
          return { ok: true, output: `Livrable prêt : ${name}` };
        },
      },
    ]);
    const result = await advanceTask(store, "t1", { autoAcceptPlan: true, tools, budgetMs: 30_000 });
    expect(result.task.statut).toBe("terminee");
    expect(result.task.contexte.fichiers).toEqual(["procedure.docx", "procedure.pptx"]);
    expect(result.task.journal?.some((entry) => entry.type === "fait")).toBe(true);
    expect(result.task.journal?.some((entry) => entry.type === "decision")).toBe(true);
    expect(result.task.journal?.some((entry) => entry.type === "reste")).toBe(true);
  });
});
