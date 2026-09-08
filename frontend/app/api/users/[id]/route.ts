import { NextResponse } from "next/server";
import { isAdminActor, requireAdmin } from "@/lib/server/require-admin";
import { deletePerson, updatePerson } from "@/lib/server/users";
import type { AccountStatus, UserRole } from "@/lib/types";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asRole(value: unknown): UserRole | null {
  if (value === "administrateur" || value === "utilisateur") return value;
  return null;
}

function asStatus(value: unknown): AccountStatus | null {
  if (value === "actif" || value === "suspendu") return value;
  return null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await requireAdmin(request);
  if (!isAdminActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
  }

  let body: {
    prenom?: string;
    nom?: string;
    role?: string;
    statut?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const role = body.role === undefined ? undefined : asRole(body.role);
  if (body.role !== undefined && !role) {
    return NextResponse.json(
      { error: "Choisissez le rôle Administrateur ou Collaborateur." },
      { status: 400 },
    );
  }

  const statut = body.statut === undefined ? undefined : asStatus(body.statut);
  if (body.statut !== undefined && !statut) {
    return NextResponse.json({ error: "Statut de compte invalide." }, { status: 400 });
  }

  const result = await updatePerson(id, actor.id, {
    prenom: body.prenom,
    nom: body.nom,
    role: role ?? undefined,
    statut: statut ?? undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json({ person: result.person });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await requireAdmin(request);
  if (!isAdminActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
  }

  const result = await deletePerson(id, actor.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
