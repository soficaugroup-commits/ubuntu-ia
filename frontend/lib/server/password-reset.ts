import "server-only";
import { emailDomain } from "@/lib/domains";
import { appUrl } from "@/lib/server/env";
import { sendPasswordResetEmail } from "@/lib/server/password-reset-mail";
import {
  createPasswordResetToken,
  hashPasswordResetToken,
  PASSWORD_RESET_TTL_MS,
} from "@/lib/server/password-reset-token";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

type ResetUser = {
  id: string;
  email: string;
  prenom: string | null;
  nom: string | null;
  statut: string | null;
};

const GENERIC_OK =
  "Si un compte actif existe pour cette adresse, un e-mail de réinitialisation vient d'être envoyé.";

const requestHits = new Map<string, { count: number; resetAt: number }>();
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const REQUEST_MAX = 5;

export async function requestPasswordReset(input: {
  request: Request;
  email: string;
}): Promise<{ ok: true; message: string } | { ok: false; code: string; message: string }> {
  const email = input.email.trim().toLowerCase();
  if (!email) {
    return { ok: false, code: "email", message: "Indiquez votre adresse e-mail professionnelle." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      ok: false,
      code: "email",
      message: "Cette adresse n'est pas reconnue comme un e-mail valide.",
    };
  }

  if (isRateLimited(email) || isRateLimited(clientIp(input.request))) {
    return {
      ok: false,
      code: "locked",
      message:
        "Trop de demandes. Réessayez dans quelques minutes, ou vérifiez votre boîte de réception.",
    };
  }
  bumpRate(email);
  bumpRate(clientIp(input.request));

  const domains = await allowedDomains();
  const domain = emailDomain(email);
  if (!domain || !domains.includes(domain)) {
    // Même réponse pour ne pas révéler les domaines / comptes.
    return { ok: true, message: GENERIC_OK };
  }

  const user = await findActiveUser(email);
  if (!user) {
    return { ok: true, message: GENERIC_OK };
  }

  const admin = supabaseAdmin();
  await admin.from("password_resets").delete().eq("user_id", user.id).is("used_at", null);

  const { token, hash } = createPasswordResetToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();
  const inserted = await admin
    .from("password_resets")
    .insert({
      user_id: user.id,
      email: user.email,
      token_hash: hash,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (inserted.error || !inserted.data) {
    console.error("[password-reset] insert", inserted.error);
    return {
      ok: false,
      code: "form",
      message: "La demande n'a pas pu être enregistrée. Réessayez plus tard.",
    };
  }

  const link = `${appUrl(input.request)}/reinitialisation/${token}`;
  const mailed = await sendPasswordResetEmail({
    to: user.email,
    prenom: user.prenom ?? "",
    nom: user.nom ?? "",
    link,
  });
  if (!mailed.ok) {
    await admin.from("password_resets").delete().eq("id", inserted.data.id);
    return { ok: false, code: "form", message: mailed.message };
  }

  return { ok: true, message: GENERIC_OK };
}

export async function readPasswordReset(
  token: string,
): Promise<
  | { ok: true; email: string; prenom: string | null; nom: string | null }
  | { ok: false; status: "invalid" | "expired" | "used" }
> {
  const row = await findResetByToken(token);
  if (!row) return { ok: false, status: "invalid" };
  if (row.used_at) return { ok: false, status: "used" };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: "expired" };
  }
  const user = await findUserById(row.user_id);
  if (!user || user.statut === "suspendu") {
    return { ok: false, status: "invalid" };
  }
  return {
    ok: true,
    email: row.email,
    prenom: user.prenom,
    nom: user.nom,
  };
}

export async function confirmPasswordReset(input: {
  token: string;
  password: string;
  confirmation: string;
}): Promise<
  | { ok: true; email: string }
  | { ok: false; code: string; field?: string; message: string }
> {
  if (input.password.length < 8) {
    return {
      ok: false,
      code: "password",
      field: "password",
      message: "Le mot de passe doit contenir au moins 8 caractères.",
    };
  }
  if (input.password !== input.confirmation) {
    return {
      ok: false,
      code: "confirmation",
      field: "confirmation",
      message: "Les deux saisies doivent être identiques.",
    };
  }

  const row = await findResetByToken(input.token);
  if (!row) {
    return {
      ok: false,
      code: "invalid",
      message: "Ce lien de réinitialisation n'est pas valide.",
    };
  }
  if (row.used_at) {
    return {
      ok: false,
      code: "used",
      message: "Ce lien a déjà été utilisé. Demandez un nouveau lien depuis la connexion.",
    };
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return {
      ok: false,
      code: "expired",
      message: "Ce lien a expiré. Demandez un nouveau lien depuis la connexion.",
    };
  }

  const user = await findUserById(row.user_id);
  if (!user || user.statut === "suspendu") {
    return {
      ok: false,
      code: "invalid",
      message: "Ce compte n'est plus disponible pour une réinitialisation.",
    };
  }

  const admin = supabaseAdmin();
  const updated = await admin.auth.admin.updateUserById(user.id, {
    password: input.password,
  });
  if (updated.error) {
    console.error("[password-reset] update", updated.error);
    return {
      ok: false,
      code: "form",
      message: "Le mot de passe n'a pas pu être mis à jour. Réessayez.",
    };
  }

  const now = new Date().toISOString();
  await admin.from("password_resets").update({ used_at: now }).eq("id", row.id);
  await admin
    .from("password_resets")
    .update({ used_at: now })
    .eq("user_id", user.id)
    .is("used_at", null);

  return { ok: true, email: user.email };
}

async function allowedDomains(): Promise<string[]> {
  const { data, error } = await supabaseAdmin().from("domaines_autorises").select("domaine");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.domaine as string);
}

async function findActiveUser(email: string): Promise<ResetUser | null> {
  const { data, error } = await supabaseAdmin()
    .from("users")
    .select("id, email, prenom, nom, statut")
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.statut === "suspendu") return null;
  return data as ResetUser;
}

async function findUserById(id: string): Promise<ResetUser | null> {
  const { data, error } = await supabaseAdmin()
    .from("users")
    .select("id, email, prenom, nom, statut")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ResetUser | null) ?? null;
}

async function findResetByToken(token: string) {
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;
  const hash = hashPasswordResetToken(token);
  const { data, error } = await supabaseAdmin()
    .from("password_resets")
    .select("id, user_id, email, expires_at, used_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as {
    id: string;
    user_id: string;
    email: string;
    expires_at: string;
    used_at: string | null;
  } | null;
}

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isRateLimited(key: string): boolean {
  const hit = requestHits.get(key);
  if (!hit) return false;
  if (Date.now() > hit.resetAt) {
    requestHits.delete(key);
    return false;
  }
  return hit.count >= REQUEST_MAX;
}

function bumpRate(key: string) {
  const now = Date.now();
  const hit = requestHits.get(key);
  if (!hit || now > hit.resetAt) {
    requestHits.set(key, { count: 1, resetAt: now + REQUEST_WINDOW_MS });
    return;
  }
  hit.count += 1;
}
