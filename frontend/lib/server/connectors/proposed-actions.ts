import "server-only";
import { claimExecution, hashCharge, reviewProposedAction, type ActionSnapshot } from "@/lib/server/actions";
import { graphMail } from "@/lib/server/connectors/graph-mail";
import { approvedDraftId } from "@/lib/server/connectors/mail-guard";
import { microsoftAccessToken } from "@/lib/server/connectors/connexions";
import { microsoftConfig } from "@/lib/server/connectors/microsoft";
import { permissionFor, writeAudit } from "@/lib/server/permissions-store";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export type ProposedView = {
  id: string;
  action: string;
  cible: string;
  apercu: string;
  statut: string;
  expireAt: string;
};

type StoredAction = ActionSnapshot & {
  id: string;
  userId: string;
  action: string;
  connecteur: string;
  cible: string;
  charge: Record<string, unknown>;
  apercu: string;
};

export async function proposeMailAction(input: {
  userId: string;
  tacheId?: string | null;
  action: "messagerie.brouillon" | "messagerie.envoyer";
  cible: string;
  apercu: string;
  charge: Record<string, unknown>;
}): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await supabaseAdmin().from("actions_proposees").insert({
    id,
    user_id: input.userId,
    tache_id: input.tacheId ?? null,
    connecteur: "microsoft",
    action: input.action,
    cible: input.cible,
    charge: input.charge,
    charge_hash: hashCharge(input.charge),
    apercu: input.apercu,
    statut: "proposee",
  });
  if (error) {
    console.error("[actions] proposition", error.message);
    throw new Error("L'action n'a pas pu être proposée.");
  }
  await writeAudit({
    userId: input.userId,
    acteur: "agent",
    action: input.action,
    connecteur: "microsoft",
    cible: input.cible,
    actionProposeeId: id,
    details: { etape: "proposee" },
  });
  return id;
}

export async function listProposedForUser(userId: string): Promise<ProposedView[]> {
  const { data, error } = await supabaseAdmin()
    .from("actions_proposees")
    .select("id, action, cible, apercu, statut, expire_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("[actions] liste", error.message);
    throw new Error("Les actions n'ont pas pu être chargées.");
  }
  return (data ?? []).map((row) => {
    const item = row as ProposedView & { expire_at: string };
    return {
      id: item.id,
      action: item.action,
      cible: item.cible,
      apercu: item.apercu,
      statut: item.statut,
      expireAt: item.expire_at,
    };
  });
}

export async function reviewStoredAction(
  userId: string,
  actionId: string,
  decision: "approuver" | "refuser",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await owned(userId, actionId);
  if (!row) return { ok: false, error: "Action introuvable." };
  const reviewed = reviewProposedAction(row, decision);
  if (!reviewed.ok) return reviewed;
  const { error } = await supabaseAdmin()
    .from("actions_proposees")
    .update({
      statut: reviewed.statut,
      approuve_par: decision === "approuver" ? userId : null,
      approuve_at: decision === "approuver" ? new Date().toISOString() : null,
    })
    .eq("id", actionId)
    .eq("statut", "proposee");
  if (error) return { ok: false, error: "L'action n'a pas pu être mise à jour." };
  await writeAudit({
    userId,
    acteur: "utilisateur",
    action: row.action,
    connecteur: row.connecteur,
    cible: row.cible,
    actionProposeeId: actionId,
    details: { etape: reviewed.statut },
  });
  return { ok: true };
}

export async function executeStoredAction(
  userId: string,
  actionId: string,
): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  const row = await owned(userId, actionId);
  if (!row) return { ok: false, error: "Action introuvable." };
  const level = await permissionFor(userId, row.action);
  if (level === "interdit") return { ok: false, error: "Cette action est interdite pour votre rôle." };
  const gate = claimExecution(row, row.charge);
  if (!gate.ok) return gate;
  const config = microsoftConfig();
  if (!config) return { ok: false, error: "Les identifiants Microsoft ne sont pas renseignés." };
  const token = await microsoftAccessToken(userId, config);
  if (!token) return { ok: false, error: "Outlook n'est pas connecté." };
  const claimed = await supabaseAdmin()
    .from("actions_proposees")
    .update({ statut: "executee", execute_at: new Date().toISOString() })
    .eq("id", actionId)
    .eq("statut", "approuvee")
    .select("id")
    .maybeSingle();
  if (claimed.error || !claimed.data) return { ok: false, error: "Cette action a déjà été exécutée." };
  try {
    const detail = await runMail(token, row);
    await writeAudit({
      userId,
      acteur: "agent",
      action: row.action,
      connecteur: "microsoft",
      cible: row.cible,
      actionProposeeId: actionId,
      details: { etape: "executee" },
    });
    return { ok: true, detail };
  } catch (error) {
    console.error("[actions] exécution", error);
    await supabaseAdmin()
      .from("actions_proposees")
      .update({ statut: "echouee", erreur: "L'exécution Outlook a échoué." })
      .eq("id", actionId);
    return { ok: false, error: "L'exécution Outlook a échoué." };
  }
}

async function runMail(token: string, row: StoredAction): Promise<string> {
  const mail = graphMail();
  if (row.action === "messagerie.envoyer") {
    const draftId = approvedDraftId(row.charge);
    if (!draftId) throw new Error("Brouillon absent.");
    await mail.sendDraft(token, draftId);
    return "Brouillon envoyé.";
  }
  const to = typeof row.charge.to === "string" ? row.charge.to : "";
  const subject = typeof row.charge.subject === "string" ? row.charge.subject : "";
  const body = typeof row.charge.body === "string" ? row.charge.body : "";
  const created = await mail.createDraft(token, { to, subject, body });
  await supabaseAdmin().from("actions_proposees").update({ resultat: { draftId: created.id } }).eq("id", row.id);
  return `Brouillon créé (${created.id}).`;
}

async function owned(userId: string, actionId: string): Promise<StoredAction | null> {
  const { data } = await supabaseAdmin()
    .from("actions_proposees")
    .select("id, user_id, action, connecteur, cible, charge, charge_hash, apercu, statut, expire_at")
    .eq("id", actionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    id: string;
    user_id: string;
    action: string;
    connecteur: string;
    cible: string;
    charge: unknown;
    charge_hash: string;
    apercu: string;
    statut: ActionSnapshot["statut"];
    expire_at: string;
  };
  const charge = row.charge && typeof row.charge === "object" ? (row.charge as Record<string, unknown>) : {};
  return {
    id: row.id,
    userId: row.user_id,
    action: row.action,
    connecteur: row.connecteur,
    cible: row.cible,
    charge,
    chargeHash: row.charge_hash,
    apercu: row.apercu,
    statut: row.statut,
    expireAt: row.expire_at,
  };
}
