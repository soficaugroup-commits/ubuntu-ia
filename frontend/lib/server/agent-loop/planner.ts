import { parsePlan, type PlannedStep, type Understanding } from "@/lib/server/agent-loop/schema";

export function planFromUnderstanding(understood: Understanding): PlannedStep[] {
  if (understood.infos_manquantes.length) {
    return [
      { type: "demander", description: understood.infos_manquantes[0], necessite_validation: false },
      { type: "chercher", description: "Rassembler les extraits internes une fois l'information obtenue.", necessite_validation: false },
      { type: "rediger", description: "Rédiger le livrable à partir des sources.", necessite_validation: false },
    ];
  }
  const steps: PlannedStep[] = [
    { type: "chercher", description: "Chercher les extraits internes pertinents.", necessite_validation: false },
    { type: "lire", description: "Lire et retenir les faits établis.", necessite_validation: false },
    { type: "rediger", description: "Rédiger le contenu du livrable.", necessite_validation: false },
    { type: "verifier", description: "Relire chiffres, citations et procédures.", necessite_validation: false },
  ];
  const outputs = understood.livrables.length ? understood.livrables : ["Livrable demandé"];
  for (const item of outputs.slice(0, 3)) {
    steps.push({
      type: "livrer",
      description: `Produire ${item}.`,
      necessite_validation: false,
    });
  }
  return steps.slice(0, 12);
}

export function plannedStepsOf(raw: unknown, understood: Understanding): PlannedStep[] {
  return parsePlan(raw) ?? planFromUnderstanding(understood);
}
