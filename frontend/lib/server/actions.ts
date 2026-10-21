import { createHash } from "node:crypto";

export type ActionStatut = "proposee" | "approuvee" | "refusee" | "executee" | "echouee" | "expiree";

export type ActionSnapshot = {
  statut: ActionStatut;
  chargeHash: string;
  expireAt: string;
  approuvePar?: string | null;
};

export type ActionDecision =
  | { ok: true; statut: ActionStatut; audit: string }
  | { ok: false; error: string };

export function hashCharge(charge: unknown): string {
  return createHash("sha256").update(canonical(charge)).digest("hex");
}

/** Approuve ou refuse une action encore proposée et non expirée. */
export function reviewProposedAction(
  action: ActionSnapshot,
  decision: "approuver" | "refuser",
  now: Date = new Date(),
): ActionDecision {
  if (expired(action, now)) return { ok: false, error: "Cette action a expiré." };
  if (action.statut === "executee") return { ok: false, error: "Cette action a déjà été exécutée." };
  if (action.statut !== "proposee") return { ok: false, error: "Cette action n'est plus en attente." };
  if (decision === "refuser") return { ok: true, statut: "refusee", audit: "Action refusée." };
  return { ok: true, statut: "approuvee", audit: "Action approuvée." };
}

/**
 * Exécute une action approuvée une seule fois, si la charge n'a pas changé
 * et si le délai de 24 h n'est pas dépassé.
 */
export function claimExecution(
  action: ActionSnapshot,
  charge: unknown,
  now: Date = new Date(),
): ActionDecision {
  if (action.statut === "executee") return { ok: false, error: "Cette action a déjà été exécutée." };
  if (action.statut !== "approuvee") return { ok: false, error: "Cette action n'est pas approuvée." };
  if (expired(action, now)) return { ok: false, error: "Cette action a expiré." };
  if (hashCharge(charge) !== action.chargeHash) {
    return { ok: false, error: "Le contenu de l'action a changé depuis l'approbation." };
  }
  return { ok: true, statut: "executee", audit: "Action exécutée." };
}

function expired(action: ActionSnapshot, now: Date): boolean {
  return new Date(action.expireAt).getTime() <= now.getTime();
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
