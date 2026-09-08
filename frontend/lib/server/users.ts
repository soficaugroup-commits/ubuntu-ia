import { supabaseAdmin } from "@/lib/server/supabase-admin";
import type { AccountStatus, UserRole } from "@/lib/types";

export type PersonRow = {
  id: string;
  email: string;
  role: UserRole;
  prenom: string | null;
  nom: string | null;
  statut: AccountStatus;
};

function asRole(value: unknown): UserRole | null {
  if (value === "administrateur" || value === "utilisateur") return value;
  return null;
}

function asStatus(value: unknown): AccountStatus {
  return value === "suspendu" ? "suspendu" : "actif";
}

export async function listPeople(): Promise<PersonRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("users")
    .select("id, email, role, prenom, nom, statut")
    .order("nom")
    .order("prenom")
    .order("email");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: asRole(row.role) ?? "utilisateur",
    prenom: row.prenom,
    nom: row.nom,
    statut: asStatus(row.statut),
  }));
}

async function loadPerson(id: string): Promise<PersonRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("users")
    .select("id, email, role, prenom, nom, statut")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const role = asRole(data.role);
  if (!role) return null;
  return {
    id: data.id,
    email: data.email,
    role,
    prenom: data.prenom,
    nom: data.nom,
    statut: asStatus(data.statut),
  };
}

async function activeAdminCount(): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("role", "administrateur")
    .eq("statut", "actif");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function isSoleActiveAdmin(person: PersonRow, admins: number): boolean {
  return person.role === "administrateur" && person.statut === "actif" && admins <= 1;
}

async function applyAuthAccess(id: string, statut: AccountStatus): Promise<void> {
  const updated = await supabaseAdmin().auth.admin.updateUserById(id, {
    ban_duration: statut === "suspendu" ? "876000h" : "none",
  });
  if (updated.error) {
    throw new Error(updated.error.message);
  }
}

export async function updatePerson(
  id: string,
  actorId: string,
  input: {
    prenom?: string;
    nom?: string;
    role?: UserRole;
    statut?: AccountStatus;
  },
): Promise<{ ok: true; person: PersonRow } | { ok: false; message: string }> {
  const person = await loadPerson(id);
  if (!person) return { ok: false, message: "Ce compte est introuvable." };

  const prenom =
    input.prenom !== undefined ? input.prenom.trim() : (person.prenom ?? "").trim();
  const nom = input.nom !== undefined ? input.nom.trim() : (person.nom ?? "").trim();
  const role = input.role ?? person.role;
  const statut = input.statut ?? person.statut;

  if (input.prenom !== undefined && !prenom) {
    return { ok: false, message: "Indiquez le prénom." };
  }
  if (input.nom !== undefined && !nom) {
    return { ok: false, message: "Indiquez le nom." };
  }

  const admins = await activeAdminCount();
  const sole = isSoleActiveAdmin(person, admins);

  if (sole && role !== "administrateur") {
    return {
      ok: false,
      message: "Il doit rester au moins un administrateur actif.",
    };
  }
  if (sole && statut === "suspendu") {
    return {
      ok: false,
      message: "Vous ne pouvez pas suspendre le dernier administrateur actif.",
    };
  }
  if (id === actorId && statut === "suspendu") {
    return {
      ok: false,
      message: "Vous ne pouvez pas suspendre votre propre compte.",
    };
  }

  const admin = supabaseAdmin();
  const updated = await admin
    .from("users")
    .update({
      prenom: prenom || person.prenom,
      nom: nom || person.nom,
      role,
      statut,
    })
    .eq("id", id)
    .select("id, email, role, prenom, nom, statut")
    .maybeSingle();

  if (updated.error || !updated.data) {
    return { ok: false, message: "Le compte n'a pas pu être mis à jour." };
  }

  if (statut !== person.statut) {
    const access = await applyAuthAccess(id, statut).then(
      () => true,
      () => false,
    );
    if (!access) {
      await admin
        .from("users")
        .update({ statut: person.statut })
        .eq("id", id);
      return {
        ok: false,
        message: "Le statut du compte n'a pas pu être appliqué à la connexion.",
      };
    }
  }

  await admin.auth.admin.updateUserById(id, {
    user_metadata: {
      prenom: updated.data.prenom,
      nom: updated.data.nom,
      role: updated.data.role,
    },
  }).catch(() => undefined);

  return {
    ok: true,
    person: {
      id: updated.data.id,
      email: updated.data.email,
      role: asRole(updated.data.role) ?? role,
      prenom: updated.data.prenom,
      nom: updated.data.nom,
      statut: asStatus(updated.data.statut),
    },
  };
}

export async function deletePerson(
  id: string,
  actorId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const person = await loadPerson(id);
  if (!person) return { ok: false, message: "Ce compte est introuvable." };
  if (id === actorId) {
    return { ok: false, message: "Vous ne pouvez pas supprimer votre propre compte." };
  }
  if (isSoleActiveAdmin(person, await activeAdminCount())) {
    return {
      ok: false,
      message: "Vous ne pouvez pas supprimer le dernier administrateur actif.",
    };
  }

  const removed = await supabaseAdmin().auth.admin.deleteUser(id);
  if (removed.error) {
    return { ok: false, message: "Le compte n'a pas pu être supprimé." };
  }
  return { ok: true };
}
