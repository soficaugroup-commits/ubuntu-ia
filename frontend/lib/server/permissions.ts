import type { UserRole } from "@/lib/types";

export type PermissionLevel = "autorise" | "validation_requise" | "interdit";

export const ACTION_KEYS = [
  "messagerie.lire",
  "messagerie.brouillon",
  "messagerie.envoyer",
  "itrack.lire",
  "itrack.mettre_a_jour",
  "calendrier.lire",
  "calendrier.creer",
  "fichiers.lire",
  "fichiers.supprimer",
] as const;

export type ActionKey = (typeof ACTION_KEYS)[number];

export type PermissionRow = {
  role: UserRole;
  action: string;
  niveau: PermissionLevel;
  organisationId?: string | null;
};

const ROLES: UserRole[] = ["administrateur", "responsable", "utilisateur"];

/** Matrice par défaut : lecture autorisée, écriture à valider, suppression interdite. */
export function defaultMatrix(): PermissionRow[] {
  return ROLES.flatMap((role) =>
    ACTION_KEYS.map((action) => ({
      role,
      action,
      niveau: defaultLevel(action),
      organisationId: null,
    })),
  );
}

export function defaultLevel(action: string): PermissionLevel {
  if (action.endsWith(".supprimer")) return "interdit";
  if (action.endsWith(".lire")) return "autorise";
  return "validation_requise";
}

export function isPermissionLevel(value: unknown): value is PermissionLevel {
  return value === "autorise" || value === "validation_requise" || value === "interdit";
}

/**
 * Droit effectif : la ligne de l'organisation prime sur le défaut du groupe.
 * Une délégation encore valide relève un interdit au niveau « à valider », sans jamais
 * sauter l'approbation.
 */
export function decidePermission(input: {
  role: UserRole;
  action: string;
  rows: PermissionRow[];
  organisationId?: string | null;
  delegationExpireAt?: string | null;
  hasDelegation?: boolean;
  now?: Date;
}): PermissionLevel {
  const now = input.now ?? new Date();
  const specific = input.rows.find(
    (row) =>
      row.role === input.role &&
      row.action === input.action &&
      row.organisationId &&
      row.organisationId === input.organisationId,
  );
  const global = input.rows.find(
    (row) => row.role === input.role && row.action === input.action && !row.organisationId,
  );
  const level = specific?.niveau ?? global?.niveau ?? "interdit";
  if (!input.hasDelegation) return level;
  const expiry = input.delegationExpireAt ? new Date(input.delegationExpireAt) : null;
  const valid = !expiry || expiry.getTime() > now.getTime();
  if (valid && level === "interdit") return "validation_requise";
  return level;
}
