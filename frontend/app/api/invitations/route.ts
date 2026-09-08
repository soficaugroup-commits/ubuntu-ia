import { NextResponse } from "next/server";
import { assertServerSecrets } from "@/lib/server/env";
import {
  createAndSendInvitation,
  listInvitations,
  listPeople,
} from "@/lib/server/invitations";
import { isAdminActor, requireAdmin } from "@/lib/server/require-admin";
import type { UserRole } from "@/lib/types";

void process.env.RESEND_API_KEY;
void process.env.RESEND_FROM_EMAIL;
void process.env.NEXT_PUBLIC_APP_URL;

export async function GET(request: Request) {
  const actor = await requireAdmin(request);
  if (!isAdminActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  try {
    const [invitations, people] = await Promise.all([
      listInvitations(),
      listPeople(),
    ]);
    return NextResponse.json({ invitations, people });
  } catch {
    return NextResponse.json(
      { error: "La liste des accès n'a pas pu être chargée." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const configured = assertServerSecrets();
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 503 });
  }

  const actor = await requireAdmin(request);
  if (!isAdminActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  let body: {
    prenom?: string;
    nom?: string;
    email?: string;
    role?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const role = body.role === "administrateur" ? "administrateur" : body.role === "utilisateur" ? "utilisateur" : null;
  if (!role) {
    return NextResponse.json(
      { error: "Choisissez le rôle Administrateur ou Collaborateur.", field: "role" },
      { status: 400 },
    );
  }

  const result = await createAndSendInvitation({
    request,
    actorId: actor.id,
    prenom: body.prenom ?? "",
    nom: body.nom ?? "",
    email: body.email ?? "",
    role: role as UserRole,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, field: result.code },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
