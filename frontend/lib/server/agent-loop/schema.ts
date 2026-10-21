import type { TaskStepType } from "@/lib/types";

const STEP_TYPES: TaskStepType[] = [
  "chercher",
  "lire",
  "rediger",
  "verifier",
  "corriger",
  "livrer",
  "demander",
  "agir",
];

export type Understanding = {
  objectif: string;
  livrables: string[];
  contraintes: string[];
  infos_manquantes: string[];
  risques: string[];
};

export type PlannedStep = {
  type: TaskStepType;
  description: string;
  necessite_validation: boolean;
};

const CONSEQUENCE =
  /\b(envoy|envoi|publier|modifier un syst[eè]me|officiel|signer|valider aupr[eè]s|agir dans)\b/i;

export function parseUnderstanding(raw: unknown): Understanding | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const objectif = typeof row.objectif === "string" ? row.objectif.trim() : "";
  if (!objectif) return null;
  return {
    objectif,
    livrables: strings(row.livrables),
    contraintes: strings(row.contraintes),
    infos_manquantes: strings(row.infos_manquantes ?? row.infosManquantes),
    risques: strings(row.risques),
  };
}

export function parsePlan(raw: unknown): PlannedStep[] | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const list = Array.isArray(row.etapes) ? row.etapes : Array.isArray(raw) ? raw : null;
  if (!list) return null;
  const steps = list.flatMap((item: unknown): PlannedStep[] => {
    if (!item || typeof item !== "object") return [];
    const next = item as Record<string, unknown>;
    const type = String(next.type ?? "");
    const description = typeof next.description === "string" ? next.description.trim() : "";
    if (!STEP_TYPES.includes(type as TaskStepType) || !description) return [];
    return [
      {
        type: type as TaskStepType,
        description,
        necessite_validation: Boolean(next.necessite_validation) || CONSEQUENCE.test(description) || type === "agir",
      },
    ];
  });
  if (steps.length < 3 || steps.length > 12) return null;
  return steps;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}
