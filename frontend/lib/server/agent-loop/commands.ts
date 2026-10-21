import { parsePlan } from "@/lib/server/agent-loop/schema";
import type { AgentTask, TaskJournalEntry, TaskJournalType } from "@/lib/types";

export type CommandResult = { ok: true; task: AgentTask } | { ok: false; error: string };

export function acceptPlan(task: AgentTask): CommandResult {
  if (task.statut !== "plan_propose") {
    return { ok: false, error: "Le plan n'est pas en attente de validation." };
  }
  if (task.plan.length < 3) return { ok: false, error: "Le plan est incomplet." };
  task.statut = "en_cours";
  note(task, "decision", "Plan validé. Exécution lancée.", "utilisateur");
  return { ok: true, task };
}

export function replacePlan(task: AgentTask, raw: unknown): CommandResult {
  if (task.statut !== "plan_propose" && task.statut !== "cadrage") {
    return { ok: false, error: "Le plan ne peut plus être modifié." };
  }
  const planned = parsePlan({ etapes: raw });
  if (!planned) return { ok: false, error: "Le plan doit contenir entre 3 et 12 étapes reconnues." };
  task.plan = planned.map((item, index) => ({
    id: crypto.randomUUID(),
    ordre: index + 1,
    type: item.type,
    description: item.description,
    statut: "a_faire" as const,
    entree: {},
    sortie: {},
    necessiteValidation: item.necessite_validation,
    tentatives: 0,
  }));
  task.statut = "plan_propose";
  note(task, "decision", "Plan modifié par l'utilisateur.", "utilisateur");
  return { ok: true, task };
}

export function answerTask(task: AgentTask, reponse: string): CommandResult {
  const text = reponse.trim();
  if (!text) return { ok: false, error: "La réponse est vide." };
  if (task.statut !== "en_attente_utilisateur") {
    return { ok: false, error: "Aucune question n'est en attente." };
  }
  note(task, "reponse", text, "utilisateur");
  task.contexte = { ...task.contexte, faits: [...(task.contexte.faits ?? []), text], infosManquantes: [] };
  const waiting = task.plan.find((step) => step.statut === "bloquee" || step.type === "demander");
  if (waiting) {
    waiting.statut = "faite";
    waiting.sortie = { ...waiting.sortie, reponse: text };
    waiting.finishedAt = new Date().toISOString();
  }
  task.statut = "en_cours";
  return { ok: true, task };
}

export function approveStep(task: AgentTask, ordre: number): CommandResult {
  const step = task.plan.find((item) => item.ordre === ordre);
  if (!step) return { ok: false, error: "Étape introuvable." };
  if (task.statut !== "en_attente_validation" && !step.necessiteValidation) {
    return { ok: false, error: "Cette étape n'attend pas de validation." };
  }
  step.sortie = { ...step.sortie, validee: true };
  step.statut = "a_faire";
  task.statut = "en_cours";
  note(task, "validation", `Étape ${ordre} validée : ${step.description}`, "utilisateur");
  return { ok: true, task };
}

export function cancelTask(task: AgentTask): CommandResult {
  if (task.statut === "terminee") return { ok: false, error: "Une tâche terminée ne s'annule pas." };
  if (task.statut === "annulee") return { ok: true, task };
  task.statut = "annulee";
  task.termineeAt = new Date().toISOString();
  note(task, "decision", "Tâche annulée.", "utilisateur");
  return { ok: true, task };
}

function note(task: AgentTask, type: TaskJournalType, contenu: string, auteur: TaskJournalEntry["auteur"]): void {
  const entry: TaskJournalEntry = {
    id: crypto.randomUUID(),
    horodatage: new Date().toISOString(),
    type,
    contenu,
    auteur,
  };
  task.journal = [...(task.journal ?? []), entry];
}
