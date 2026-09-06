import { emailDomain } from "@/lib/domains";
import { appUrl } from "@/lib/server/env";
import { sendInvitationEmail } from "@/lib/server/invitation-mail";
import {
  createInviteToken,
  hashInviteToken,
  INVITE_TTL_MS,
} from "@/lib/server/invitation-token";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import type { UserRole } from "@/lib/types";

export type InvitationRow = {
  id: string;
  email: string;
  prenom: string;
  nom: string;
  role: UserRole;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

export const ROLE_LABEL: Record<UserRole, string> = {
  administrateur: "Administrateur",
  utilisateur: "Collaborateur",
};

function asRole(value: unknown): UserRole | null {
  if (value === "administrateur" || value === "utilisateur") return value;
  return null;
}

export async function listInvitations(): Promise<InvitationRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("invitations")
    .select("id, email, prenom, nom, role, expires_at, accepted_at, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as InvitationRow[];
}

export async function listPeople() {
  const { data, error } = await supabaseAdmin()
    .from("users")
    .select("id, email, role, prenom, nom")
    .order("email");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function allowedDomains(): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from("domaines_autorises")
    .select("domaine");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.domaine);
}

async function emailAlreadyUsed(email: string): Promise<boolean> {
  const users = await supabaseAdmin()
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  return Boolean(users.data);
}

export async function createAndSendInvitation(input: {
  request: Request;
  actorId: string;
  prenom: string;
  nom: string;
  email: string;
  role: UserRole;
}): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const prenom = input.prenom.trim();
  const nom = input.nom.trim();
  const email = input.email.trim().toLowerCase();
  const role = input.role;

  if (!prenom) return { ok: false, code: "prenom", message: "Indiquez le prénom." };
  if (!nom) return { ok: false, code: "nom", message: "Indiquez le nom." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, code: "email", message: "Cette adresse n'est pas reconnue comme un e-mail valide." };
  }

  const domains = await allowedDomains();
  const domain = emailDomain(email);
  if (!domain || !domains.includes(domain)) {
    return {
      ok: false,
      code: "email",
      message: "Cette adresse n'appartient pas à un domaine autorisé.",
    };
  }

  if (await emailAlreadyUsed(email)) {
    return {
      ok: false,
      code: "email",
      message: "Un compte existe déjà pour cette adresse.",
    };
  }

  const admin = supabaseAdmin();
  await admin.from("invitations").delete().eq("email", email).is("accepted_at", null);

  const { token, hash } = createInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const inserted = await admin
    .from("invitations")
    .insert({
      email,
      prenom,
      nom,
      role,
      token_hash: hash,
      invited_by: input.actorId,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (inserted.error || !inserted.data) {
    return {
      ok: false,
      code: "form",
      message: "L'invitation n'a pas pu être enregistrée.",
    };
  }

  const link = `${appUrl(input.request)}/invitation/${token}`;
  const sent = await sendInvitationEmail({
    to: email,
    prenom,
    nom,
    roleLabel: ROLE_LABEL[role],
    link,
  });

  if (!sent.ok) {
    await admin.from("invitations").delete().eq("id", inserted.data.id);
    return { ok: false, code: "form", message: sent.message };
  }

  return { ok: true };
}

export async function resendInvitation(
  request: Request,
  id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const admin = supabaseAdmin();
  const current = await admin
    .from("invitations")
    .select("id, email, prenom, nom, role, accepted_at")
    .eq("id", id)
    .maybeSingle();

  if (!current.data) return { ok: false, message: "Invitation introuvable." };
  if (current.data.accepted_at) {
    return { ok: false, message: "Cette invitation a déjà été utilisée." };
  }
  if (await emailAlreadyUsed(current.data.email)) {
    return { ok: false, message: "Un compte existe déjà pour cette adresse." };
  }

  const { token, hash } = createInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const updated = await admin
    .from("invitations")
    .update({ token_hash: hash, expires_at: expiresAt })
    .eq("id", id);

  if (updated.error) {
    return { ok: false, message: "L'invitation n'a pas pu être renouvelée." };
  }

  const sent = await sendInvitationEmail({
    to: current.data.email,
    prenom: current.data.prenom,
    nom: current.data.nom,
    roleLabel: ROLE_LABEL[asRole(current.data.role) ?? "utilisateur"],
    link: `${appUrl(request)}/invitation/${token}`,
  });
  if (!sent.ok) return { ok: false, message: sent.message };
  return { ok: true };
}

export async function readInvitation(token: string): Promise<
  | {
      ok: true;
      prenom: string;
      nom: string;
      email: string;
      role: UserRole;
    }
  | { ok: false; code: "invalid" | "expired" | "used" }
> {
  if (!/^[a-f0-9]{64}$/.test(token)) return { ok: false, code: "invalid" };
  const { data } = await supabaseAdmin()
    .from("invitations")
    .select("prenom, nom, email, role, expires_at, accepted_at")
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle();

  if (!data) return { ok: false, code: "invalid" };
  if (data.accepted_at) return { ok: false, code: "used" };
  if (new Date(data.expires_at).getTime() <= Date.now()) {
    return { ok: false, code: "expired" };
  }
  const role = asRole(data.role);
  if (!role) return { ok: false, code: "invalid" };
  return {
    ok: true,
    prenom: data.prenom,
    nom: data.nom,
    email: data.email,
    role,
  };
}

export async function acceptInvitation(input: {
  token: string;
  password: string;
  confirmation: string;
}): Promise<{ ok: true; email: string } | { ok: false; code: string; message: string }> {
  if (input.password.length < 8) {
    return {
      ok: false,
      code: "password",
      message: "Le mot de passe doit contenir au moins 8 caractères.",
    };
  }
  if (input.password !== input.confirmation) {
    return {
      ok: false,
      code: "confirmation",
      message: "Les deux saisies doivent être identiques.",
    };
  }

  const invitation = await readInvitation(input.token);
  if (!invitation.ok) {
    const messages = {
      invalid: "Ce lien d'invitation n'est pas valide.",
      expired: "Ce lien d'invitation a expiré. Demandez un nouvel envoi.",
      used: "Ce lien a déjà été utilisé. Connectez-vous avec votre mot de passe.",
    };
    return { ok: false, code: "form", message: messages[invitation.code] };
  }

  if (await emailAlreadyUsed(invitation.email)) {
    return {
      ok: false,
      code: "form",
      message: "Un compte existe déjà pour cette adresse. Connectez-vous.",
    };
  }

  const admin = supabaseAdmin();
  const created = await admin.auth.admin.createUser({
    email: invitation.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      prenom: invitation.prenom,
      nom: invitation.nom,
      role: invitation.role,
    },
  });

  if (created.error || !created.data.user) {
    return {
      ok: false,
      code: "form",
      message: "Le compte n'a pas pu être créé. Réessayez ou contactez un administrateur.",
    };
  }

  await admin
    .from("users")
    .update({
      prenom: invitation.prenom,
      nom: invitation.nom,
      role: invitation.role,
      organisation: "SOFICAU UBUNTU GROUP",
    })
    .eq("id", created.data.user.id);

  await admin
    .from("invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("token_hash", hashInviteToken(input.token));

  return { ok: true, email: invitation.email };
}
