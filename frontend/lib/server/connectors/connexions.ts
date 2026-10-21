import "server-only";
import { decryptSecret, encryptSecret } from "@/lib/server/crypto";
import { microsoftConfig, outlookEnabled, type MicrosoftConfig } from "@/lib/server/connectors/microsoft";
import { refreshAccess, type TokenBundle } from "@/lib/server/connectors/microsoft-token";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export type OutlookStatus = {
  active: boolean;
  configured: boolean;
  compte: string | null;
};

export async function outlookStatus(userId: string): Promise<OutlookStatus> {
  const configured = Boolean(microsoftConfig());
  const client = supabaseAdmin();
  const { data: profile } = await client.from("users").select("organisation_id").eq("id", userId).maybeSingle();
  const orgId = (profile as { organisation_id?: string | null } | null)?.organisation_id ?? null;
  let active = false;
  if (orgId) {
    const org = await client.from("organisations").select("fonctionnalites").eq("id", orgId).maybeSingle();
    if (!org.error) active = outlookEnabled((org.data as { fonctionnalites?: unknown } | null)?.fonctionnalites);
  }
  const link = await client
    .from("connexions_outils")
    .select("compte, statut")
    .eq("user_id", userId)
    .eq("fournisseur", "microsoft")
    .eq("statut", "actif")
    .maybeSingle();
  const compte = (link.data as { compte?: string } | null)?.compte ?? null;
  return { active, configured, compte: link.error ? null : compte };
}

export async function setOutlookEnabled(userId: string, enabled: boolean): Promise<void> {
  const client = supabaseAdmin();
  const { data: profile } = await client.from("users").select("organisation_id").eq("id", userId).maybeSingle();
  const orgId = (profile as { organisation_id?: string | null } | null)?.organisation_id;
  if (!orgId) throw new Error("Aucune organisation n'est enregistrée.");
  const current = await client.from("organisations").select("fonctionnalites").eq("id", orgId).maybeSingle();
  const previous =
    current.data && typeof (current.data as { fonctionnalites?: unknown }).fonctionnalites === "object"
      ? ((current.data as { fonctionnalites: Record<string, unknown> }).fonctionnalites ?? {})
      : {};
  const { error } = await client
    .from("organisations")
    .update({ fonctionnalites: { ...previous, outlook: enabled } })
    .eq("id", orgId);
  if (error) {
    console.error("[outlook] drapeau", error.message);
    throw new Error("Le connecteur n'a pas pu être activé.");
  }
}

export async function saveMicrosoftTokens(userId: string, bundle: TokenBundle, key: string): Promise<void> {
  const { error } = await supabaseAdmin().from("connexions_outils").upsert(
    {
      user_id: userId,
      fournisseur: "microsoft",
      compte: bundle.account,
      scopes: "offline_access User.Read Mail.ReadWrite Mail.Send",
      jeton_chiffre: encryptSecret(JSON.stringify(bundle), key),
      expire_at: bundle.expiresAt,
      statut: "actif",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,fournisseur" },
  );
  if (error) {
    console.error("[outlook] enregistrement", error.message);
    throw new Error("La connexion Outlook n'a pas pu être enregistrée.");
  }
}

export async function revokeMicrosoft(userId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("connexions_outils")
    .delete()
    .eq("user_id", userId)
    .eq("fournisseur", "microsoft");
  if (error) {
    console.error("[outlook] révocation", error.message);
    throw new Error("La déconnexion Outlook a échoué.");
  }
}

export async function microsoftAccessToken(userId: string, config: MicrosoftConfig): Promise<string | null> {
  const client = supabaseAdmin();
  const { data, error } = await client
    .from("connexions_outils")
    .select("jeton_chiffre, expire_at, compte")
    .eq("user_id", userId)
    .eq("fournisseur", "microsoft")
    .eq("statut", "actif")
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { jeton_chiffre: string; expire_at: string | null; compte: string };
  let bundle: TokenBundle;
  try {
    bundle = JSON.parse(decryptSecret(row.jeton_chiffre, config.encryptionKey)) as TokenBundle;
  } catch (reason) {
    console.error("[outlook] déchiffrement", reason);
    return null;
  }
  const fresh = row.expire_at && new Date(row.expire_at).getTime() > Date.now() + 60_000;
  if (fresh) return bundle.accessToken;
  const next = await refreshAccess(config, bundle.refreshToken);
  const saved: TokenBundle = { ...next, account: bundle.account || row.compte };
  await saveMicrosoftTokens(userId, saved, config.encryptionKey);
  return saved.accessToken;
}
