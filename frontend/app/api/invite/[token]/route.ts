import { NextResponse } from "next/server";
import { readInvitation, ROLE_LABEL } from "@/lib/server/invitations";

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context) {
  const { token } = await context.params;
  const invitation = await readInvitation(token);
  if (!invitation.ok) {
    return NextResponse.json({ status: invitation.code }, { status: 404 });
  }
  return NextResponse.json({
    prenom: invitation.prenom,
    nom: invitation.nom,
    email: invitation.email,
    role: invitation.role,
    roleLabel: ROLE_LABEL[invitation.role],
  });
}
