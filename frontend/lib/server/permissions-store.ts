import "server-only";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import {
  decidePermission,
  isPermissionLevel,
  type PermissionLevel,
  type PermissionRow,
} from "@/lib/server/permissions";
import type { UserRole } from "@/lib/types";

const ROLES: UserRole[] = ["administrateur", "responsable", "utilisateur"];

export async function listPermissionRows(): Promise<PermissionRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("permissions_actions")
    .select("role, action, niveau, organisation_id")
    .order("action");
  if (error) {
    console.error("[droits] liste", error.message);
    throw new Error("Les droits n'ont pas pu être chargés.");
  }
  return (data ?? []).flatMap((row) => {
    const record = row as { role?: string; action?: string; niveau?: string; organisation_id?: string | null };
    if (!ROLES.includes(record.role as UserRole) || !record.action || !isPermissionLevel(record.niveau)) return [];
    return [
      {
        role: record.role as UserRole,
        action: record.action,
        niveau: record.niveau,
        organisationId: record.organisation_id ?? null,
      },
    ];
  });
}

export async function setPermissionLevel(role: UserRole, action: string, niveau: PermissionLevel): Promise<void> {
  const client = supabaseAdmin();
  const existing = await client
    .from("permissions_actions")
    .select("id")
    .eq("role", role)
    .eq("action", action)
    .is("organisation_id", null)
    .maybeSingle();
  const write = existing.data
    ? client.from("permissions_actions").update({ niveau }).eq("id", (existing.data as { id: string }).id)
    : client.from("permissions_actions").insert({ role, action, niveau, organisation_id: null });
  const { error } = await write;
  if (error) {
    console.error("[droits] mise à jour", error.message);
    throw new Error("Le droit n'a pas pu être enregistré.");
  }
}

export async function permissionFor(userId: string, action: string): Promise<PermissionLevel> {
  const client = supabaseAdmin();
  const { data: user } = await client.from("users").select("role, organisation_id").eq("id", userId).maybeSingle();
  const role = (user as { role?: UserRole } | null)?.role;
  if (!role || !ROLES.includes(role)) return "interdit";
  const organisationId = (user as { organisation_id?: string | null }).organisation_id ?? null;
  const rows = await listPermissionRows();
  const { data: delegation } = await client
    .from("delegations")
    .select("expire_at")
    .eq("a_user_id", userId)
    .eq("action", action)
    .order("expire_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return decidePermission({
    role,
    action,
    rows,
    organisationId,
    hasDelegation: Boolean(delegation),
    delegationExpireAt: (delegation as { expire_at?: string | null } | null)?.expire_at ?? null,
  });
}

export type AuditEntry = {
  id: string;
  horodatage: string;
  userId: string | null;
  acteur: "agent" | "utilisateur";
  action: string;
  connecteur: string;
  cible: string;
  details: Record<string, unknown>;
};

export async function listAudit(limit = 100): Promise<AuditEntry[]> {
  const { data, error } = await supabaseAdmin()
    .from("journal_audit")
    .select("id, horodatage, user_id, acteur, action, connecteur, cible, details")
    .order("horodatage", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[audit] liste", error.message);
    throw new Error("Le journal n'a pas pu être chargé.");
  }
  return (data ?? []).map((row) => {
    const record = row as {
      id: string;
      horodatage: string;
      user_id: string | null;
      acteur: string;
      action: string;
      connecteur: string;
      cible: string;
      details: unknown;
    };
    return {
      id: record.id,
      horodatage: record.horodatage,
      userId: record.user_id,
      acteur: record.acteur === "utilisateur" ? "utilisateur" : "agent",
      action: record.action,
      connecteur: record.connecteur,
      cible: record.cible,
      details: record.details && typeof record.details === "object" ? (record.details as Record<string, unknown>) : {},
    };
  });
}

export async function writeAudit(entry: {
  userId: string | null;
  acteur: "agent" | "utilisateur";
  action: string;
  connecteur?: string;
  cible?: string;
  actionProposeeId?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabaseAdmin().from("journal_audit").insert({
    user_id: entry.userId,
    acteur: entry.acteur,
    action: entry.action,
    connecteur: entry.connecteur ?? "",
    cible: entry.cible ?? "",
    action_proposee_id: entry.actionProposeeId ?? null,
    details: entry.details ?? {},
  });
  if (error) console.error("[audit] écriture", error.message);
}
