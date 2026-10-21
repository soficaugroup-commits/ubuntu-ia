import "server-only";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import type {
  AgentTask,
  TaskBudget,
  TaskContext,
  TaskJournalEntry,
  TaskJournalType,
  TaskStatus,
  TaskStep,
  TaskStepStatus,
  TaskStepType,
} from "@/lib/types";

export const TASK_STATUSES: TaskStatus[] = [
  "cadrage",
  "plan_propose",
  "en_cours",
  "en_attente_utilisateur",
  "en_attente_validation",
  "terminee",
  "echouee",
  "annulee",
];

export const STEP_TYPES: TaskStepType[] = [
  "chercher",
  "lire",
  "rediger",
  "verifier",
  "corriger",
  "livrer",
  "demander",
  "agir",
];

export const STEP_STATUSES: TaskStepStatus[] = ["a_faire", "en_cours", "faite", "sautee", "echouee", "bloquee"];

export const JOURNAL_TYPES: TaskJournalType[] = [
  "fait",
  "reste",
  "decision",
  "question",
  "reponse",
  "erreur",
  "validation",
];

const TASK_COLUMNS =
  "id, user_id, organisation_id, conversation_id, dossier_id, titre, objectif, statut, plan, contexte, etape_courante, budget, created_at, updated_at, terminee_at";

type TaskRow = {
  id: string;
  user_id: string;
  organisation_id: string | null;
  conversation_id: string | null;
  dossier_id: string | null;
  titre: string;
  objectif: string;
  statut: TaskStatus;
  plan: unknown;
  contexte: unknown;
  etape_courante: number;
  budget: unknown;
  created_at: string;
  updated_at: string;
  terminee_at: string | null;
};

type StepRow = {
  id: string;
  ordre: number;
  type: TaskStepType;
  description: string;
  statut: TaskStepStatus;
  entree: unknown;
  sortie: unknown;
  necessite_validation: boolean;
  tentatives: number;
  started_at: string | null;
  finished_at: string | null;
  erreur: string | null;
};

type JournalRow = {
  id: string;
  horodatage: string;
  type: TaskJournalType;
  contenu: string;
  auteur: "agent" | "utilisateur";
};

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && TASK_STATUSES.includes(value as TaskStatus);
}

export function mapTask(row: TaskRow, steps: TaskStep[] = [], journal?: TaskJournalEntry[]): AgentTask {
  return {
    id: row.id,
    userId: row.user_id,
    organisationId: row.organisation_id,
    conversationId: row.conversation_id,
    dossierId: row.dossier_id,
    titre: row.titre,
    objectif: row.objectif,
    statut: isTaskStatus(row.statut) ? row.statut : "cadrage",
    plan: steps.length ? steps : asSteps(row.plan),
    contexte: asContext(row.contexte),
    etapeCourante: row.etape_courante,
    budget: asBudget(row.budget),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    termineeAt: row.terminee_at,
    journal,
  };
}

export function mapStep(row: StepRow): TaskStep {
  return {
    id: row.id,
    ordre: row.ordre,
    type: STEP_TYPES.includes(row.type) ? row.type : "chercher",
    description: row.description,
    statut: STEP_STATUSES.includes(row.statut) ? row.statut : "a_faire",
    entree: asRecord(row.entree),
    sortie: asRecord(row.sortie),
    necessiteValidation: Boolean(row.necessite_validation),
    tentatives: row.tentatives,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    erreur: row.erreur,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asContext(value: unknown): TaskContext {
  const row = asRecord(value);
  const list = (key: string) =>
    Array.isArray(row[key]) ? row[key].filter((item): item is string => typeof item === "string") : undefined;
  return {
    faits: list("faits"),
    decisions: list("decisions"),
    fichiers: list("fichiers"),
    sources: list("sources"),
    infosManquantes: list("infosManquantes"),
  };
}

function asBudget(value: unknown): TaskBudget {
  const row = asRecord(value);
  return {
    maxEtapes: typeof row.maxEtapes === "number" ? row.maxEtapes : undefined,
    maxCout: typeof row.maxCout === "number" ? row.maxCout : undefined,
    echeance: typeof row.echeance === "string" ? row.echeance : undefined,
  };
}

function asSteps(value: unknown): TaskStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return [
      {
        id: typeof row.id === "string" ? row.id : `plan-${index + 1}`,
        ordre: typeof row.ordre === "number" ? row.ordre : index + 1,
        type: STEP_TYPES.includes(row.type as TaskStepType) ? (row.type as TaskStepType) : "chercher",
        description: typeof row.description === "string" ? row.description : "",
        statut: STEP_STATUSES.includes(row.statut as TaskStepStatus) ? (row.statut as TaskStepStatus) : "a_faire",
        entree: asRecord(row.entree),
        sortie: asRecord(row.sortie),
        necessiteValidation: Boolean(row.necessiteValidation ?? row.necessite_validation),
        tentatives: typeof row.tentatives === "number" ? row.tentatives : 0,
      },
    ];
  });
}

async function organisationOf(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin().from("users").select("organisation_id").eq("id", userId).maybeSingle();
  return (data?.organisation_id as string | null | undefined) ?? null;
}

export async function createTask(input: {
  userId: string;
  conversationId?: string | null;
  titre: string;
  objectif: string;
  budget?: TaskBudget;
}): Promise<AgentTask> {
  const organisationId = await organisationOf(input.userId);
  const { data, error } = await supabaseAdmin()
    .from("taches")
    .insert({
      user_id: input.userId,
      organisation_id: organisationId,
      conversation_id: input.conversationId ?? null,
      titre: input.titre.trim().slice(0, 200),
      objectif: input.objectif.trim(),
      statut: "cadrage",
      budget: input.budget ?? { maxEtapes: 12 },
    })
    .select(TASK_COLUMNS)
    .single();
  if (error || !data) {
    console.error("[taches] création", error?.message);
    throw new Error("La tâche n'a pas pu être créée.");
  }
  return mapTask(data as TaskRow);
}

export async function listTasksForUser(userId: string, limit = 40): Promise<AgentTask[]> {
  const { data, error } = await supabaseAdmin()
    .from("taches")
    .select(TASK_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[taches] liste", error.message);
    throw new Error("Les tâches n'ont pas pu être chargées.");
  }
  return ((data ?? []) as TaskRow[]).map((row) => mapTask(row));
}

export async function getTaskForUser(userId: string, id: string): Promise<AgentTask | null> {
  const client = supabaseAdmin();
  const { data, error } = await client.from("taches").select(TASK_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("[taches] lecture", error.message);
    throw new Error("La tâche n'a pas pu être chargée.");
  }
  const row = data as TaskRow | null;
  if (!row || row.user_id !== userId) return null;
  const [{ data: steps }, { data: journal }] = await Promise.all([
    client.from("etapes_tache").select("*").eq("tache_id", id).order("ordre"),
    client.from("journal_tache").select("id, horodatage, type, contenu, auteur").eq("tache_id", id).order("horodatage"),
  ]);
  return mapTask(
    row,
    ((steps ?? []) as StepRow[]).map(mapStep),
    ((journal ?? []) as JournalRow[]).map((item) => ({
      id: item.id,
      horodatage: item.horodatage,
      type: JOURNAL_TYPES.includes(item.type) ? item.type : "fait",
      contenu: item.contenu,
      auteur: item.auteur === "utilisateur" ? "utilisateur" : "agent",
    })),
  );
}

export async function appendTaskJournal(
  taskId: string,
  entry: { type: TaskJournalType; contenu: string; auteur?: "agent" | "utilisateur" },
): Promise<void> {
  const { error } = await supabaseAdmin().from("journal_tache").insert({
    tache_id: taskId,
    type: entry.type,
    contenu: entry.contenu.trim(),
    auteur: entry.auteur ?? "agent",
  });
  if (error) console.error("[taches] journal", error.message);
}

export async function claimTask(taskId: string, until: Date): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc("claim_tache", {
    p_id: taskId,
    p_until: until.toISOString(),
  });
  if (error) {
    console.error("[taches] verrou", error.message);
    return false;
  }
  return data === true;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ensureUuid(id: string): string {
  return UUID.test(id) ? id : crypto.randomUUID();
}

/** Écrit l'état complet (tâche, étapes, nouvelles lignes de journal) après une étape du runner. */
export async function persistTask(userId: string, task: AgentTask): Promise<void> {
  if (task.userId !== userId) throw new Error("Tâche introuvable.");
  const idMap = new Map<string, string>();
  for (const step of task.plan) {
    const next = ensureUuid(step.id);
    if (next !== step.id) idMap.set(step.id, next);
    step.id = next;
  }
  for (const step of task.plan) {
    const from = step.entree.from;
    if (typeof from === "string" && idMap.has(from)) step.entree = { ...step.entree, from: idMap.get(from) };
  }
  const client = supabaseAdmin();
  const { error } = await client
    .from("taches")
    .update({
      objectif: task.objectif,
      statut: task.statut,
      plan: task.plan,
      contexte: task.contexte,
      etape_courante: task.etapeCourante,
      terminee_at: task.termineeAt,
    })
    .eq("id", task.id)
    .eq("user_id", userId);
  if (error) {
    console.error("[taches] enregistrement", error.message);
    throw new Error("La tâche n'a pas pu être enregistrée.");
  }
  const removed = await client.from("etapes_tache").delete().eq("tache_id", task.id);
  if (removed.error) console.error("[taches] étapes", removed.error.message);
  if (task.plan.length) {
    const inserted = await client.from("etapes_tache").insert(
      task.plan.map((step) => ({
        id: step.id,
        tache_id: task.id,
        ordre: step.ordre,
        type: step.type,
        description: step.description,
        statut: step.statut,
        entree: step.entree,
        sortie: step.sortie,
        necessite_validation: step.necessiteValidation,
        tentatives: step.tentatives,
        started_at: step.startedAt ?? null,
        finished_at: step.finishedAt ?? null,
        erreur: step.erreur ?? null,
      })),
    );
    if (inserted.error) {
      console.error("[taches] insertion étapes", inserted.error.message);
      throw new Error("Les étapes n'ont pas pu être enregistrées.");
    }
  }
  const fresh = (task.journal ?? []).filter((entry) => !UUID.test(entry.id) && entry.contenu.trim());
  if (!fresh.length) return;
  const journal = await client
    .from("journal_tache")
    .insert(
      fresh.map((entry) => ({
        tache_id: task.id,
        type: entry.type,
        contenu: entry.contenu.trim(),
        auteur: entry.auteur,
        horodatage: entry.horodatage,
      })),
    )
    .select("id");
  if (journal.error) {
    console.error("[taches] journal", journal.error.message);
    return;
  }
  const ids = (journal.data ?? []) as { id: string }[];
  fresh.forEach((entry, index) => {
    if (ids[index]?.id) entry.id = ids[index].id;
  });
}

export async function releaseTask(taskId: string): Promise<void> {
  const { error } = await supabaseAdmin().from("taches").update({ verrou_jusqua: null }).eq("id", taskId);
  if (error) console.error("[taches] verrou", error.message);
}

export async function updateTaskStatus(
  taskId: string,
  statut: TaskStatus,
  extra: Partial<{ etape_courante: number; contexte: TaskContext; plan: TaskStep[]; terminee_at: string | null }> = {},
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("taches")
    .update({
      statut,
      ...extra,
      terminee_at:
        extra.terminee_at !== undefined
          ? extra.terminee_at
          : statut === "terminee" || statut === "echouee" || statut === "annulee"
            ? new Date().toISOString()
            : undefined,
    })
    .eq("id", taskId);
  if (error) {
    console.error("[taches] statut", error.message);
    throw new Error("La tâche n'a pas pu être mise à jour.");
  }
}
