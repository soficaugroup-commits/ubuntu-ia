import { executeStep } from "@/lib/server/agent-loop/executor";
import { plannedStepsOf } from "@/lib/server/agent-loop/planner";
import { defaultTools, type ToolRegistry } from "@/lib/server/agent-loop/tools/registry";
import { understandingOf, type Understanding } from "@/lib/server/agent-loop/understand";
import { isBlockingReview } from "@/lib/server/agent-loop/verifier";
import type { AgentTask, TaskJournalEntry, TaskStep, TaskStepStatus } from "@/lib/types";

export type TaskStore = {
  load: (id: string) => Promise<AgentTask | null>;
  save: (task: AgentTask) => Promise<void>;
  claim: (id: string, until: Date) => Promise<boolean>;
  release?: (id: string) => Promise<void>;
};

export type AdvanceOptions = {
  budgetMs?: number;
  autoAcceptPlan?: boolean;
  tools?: ToolRegistry;
  now?: () => number;
};

export type AdvanceEvent =
  | { type: "tache_plan"; task: AgentTask }
  | { type: "tache_etape"; step: TaskStep; phase: "debut" | "fin" }
  | { type: "tache_question"; question: string }
  | { type: "tache_validation_requise"; step: TaskStep }
  | { type: "tache_journal"; entry: TaskJournalEntry }
  | { type: "tache_fin"; task: AgentTask };

const DEFAULT_BUDGET = 240_000;
const LOCK_MS = 250_000;
const MAX_TRIES = 3;

export async function advanceTask(
  store: TaskStore,
  taskId: string,
  options: AdvanceOptions = {},
): Promise<{ task: AgentTask; events: AdvanceEvent[] }> {
  const tools = options.tools ?? defaultTools();
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? DEFAULT_BUDGET);
  const events: AdvanceEvent[] = [];
  const locked = await store.claim(taskId, new Date(now() + LOCK_MS));
  if (!locked) {
    const current = await store.load(taskId);
    if (!current) throw new Error("Tâche introuvable.");
    return { task: current, events };
  }
  const task = await store.load(taskId);
  if (!task) throw new Error("Tâche introuvable.");

  try {
    if (task.statut === "cadrage") {
      await frameTask(task, store, events, options.autoAcceptPlan);
    }
    if (task.statut === "plan_propose" && options.autoAcceptPlan) {
      task.statut = "en_cours";
      note(task, events, "decision", "Plan accepté, exécution.");
      await store.save(task);
    }
    if (task.statut !== "en_cours") return { task, events };

    while (now() < deadline) {
      const step = task.plan.find((item) => item.statut === "a_faire" || item.statut === "en_cours");
      if (!step) {
        task.statut = "terminee";
        task.termineeAt = new Date(now()).toISOString();
        note(task, events, "fait", "Toutes les étapes sont faites.");
        events.push({ type: "tache_fin", task });
        await store.save(task);
        break;
      }
      if (step.statut === "faite") continue;
      if (step.necessiteValidation && step.sortie.validee !== true) {
        task.statut = "en_attente_validation";
        step.statut = "bloquee";
        events.push({ type: "tache_validation_requise", step });
        note(task, events, "validation", `Étape « ${step.description} » en attente de validation.`);
        await store.save(task);
        break;
      }
      step.statut = "en_cours";
      step.startedAt = step.startedAt ?? new Date(now()).toISOString();
      step.tentatives += 1;
      task.etapeCourante = step.ordre;
      events.push({ type: "tache_etape", step: { ...step }, phase: "debut" });
      await store.save(task);

      const result = await executeStep(task, step, tools);
      if (result.askUser) {
        step.statut = "bloquee";
        task.statut = "en_attente_utilisateur";
        events.push({ type: "tache_question", question: result.askUser });
        note(task, events, "question", result.askUser);
        await store.save(task);
        break;
      }
      if (!result.ok) {
        step.erreur = result.output;
        if (step.tentatives >= MAX_TRIES) {
          step.statut = "echouee";
          task.statut = "echouee";
          task.termineeAt = new Date(now()).toISOString();
          note(task, events, "erreur", result.output);
          events.push({ type: "tache_fin", task });
        } else {
          step.statut = "a_faire";
        }
        await store.save(task);
        if (task.statut === "echouee") break;
        continue;
      }
      step.sortie = { ...step.sortie, ...result.data, resume: result.output };
      step.statut = "faite";
      step.finishedAt = new Date(now()).toISOString();
      step.erreur = null;
      if (result.data?.review && isBlockingReview(result.data.review as never) && correctionsFor(task, step) < 2) {
        insertCorrection(task, step);
      }
      events.push({ type: "tache_etape", step: { ...step }, phase: "fin" });
      note(task, events, "fait", result.output);
      await store.save(task);
    }
  } finally {
    await store.release?.(taskId);
  }
  return { task, events };
}

async function frameTask(
  task: AgentTask,
  store: TaskStore,
  events: AdvanceEvent[],
  autoAcceptPlan?: boolean,
): Promise<void> {
  const understood: Understanding = understandingOf(task.contexte, task.objectif || task.titre);
  task.objectif = understood.objectif;
  task.contexte = {
    ...task.contexte,
    infosManquantes: understood.infos_manquantes,
  };
  if (understood.infos_manquantes.length && !autoAcceptPlan) {
    task.statut = "en_attente_utilisateur";
    events.push({ type: "tache_question", question: understood.infos_manquantes[0] });
    note(task, events, "question", understood.infos_manquantes[0]);
    await store.save(task);
    return;
  }
  const planned = plannedStepsOf(undefined, understood);
  task.plan = planned.map((item, index) => ({
    id: `${task.id}-s${index + 1}`,
    ordre: index + 1,
    type: item.type,
    description: item.description,
    statut: "a_faire" as TaskStepStatus,
    entree: {},
    sortie: {},
    necessiteValidation: item.necessite_validation,
    tentatives: 0,
  }));
  task.statut = "plan_propose";
  events.push({ type: "tache_plan", task });
  note(task, events, "reste", `Plan proposé (${task.plan.length} étapes).`);
  await store.save(task);
}

function insertCorrection(task: AgentTask, after: TaskStep): void {
  const ordre = after.ordre + 1;
  for (const step of task.plan) {
    if (step.ordre >= ordre) step.ordre += 1;
  }
  task.plan.push({
    id: `${task.id}-corr-${after.ordre}`,
    ordre,
    type: "corriger",
    description: `Corriger les points de relecture de « ${after.description} ».`,
    statut: "a_faire",
    entree: { from: after.id },
    sortie: {},
    necessiteValidation: false,
    tentatives: 0,
  });
  task.plan.sort((a, b) => a.ordre - b.ordre);
}

function correctionsFor(task: AgentTask, step: TaskStep): number {
  return task.plan.filter((item) => item.type === "corriger" && item.entree.from === step.id).length;
}

function note(
  task: AgentTask,
  events: AdvanceEvent[],
  type: TaskJournalEntry["type"],
  contenu: string,
): void {
  const entry: TaskJournalEntry = {
    id: `${task.id}-j${(task.journal?.length ?? 0) + 1}`,
    horodatage: new Date().toISOString(),
    type,
    contenu,
    auteur: "agent",
  };
  task.journal = [...(task.journal ?? []), entry];
  events.push({ type: "tache_journal", entry });
}
