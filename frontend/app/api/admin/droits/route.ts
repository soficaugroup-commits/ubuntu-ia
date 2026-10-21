/** GET/PATCH /api/admin/droits — matrice rôle × action. */
import { NextResponse } from "next/server";
import { isPermissionLevel } from "@/lib/server/permissions";
import { listPermissionRows, setPermissionLevel } from "@/lib/server/permissions-store";
import { isAdminActor, requireAdmin } from "@/lib/server/require-admin";
import type { UserRole } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ROLES: UserRole[] = ["administrateur", "responsable", "utilisateur"];

export async function GET(request: Request) {
  const actor = await requireAdmin(request);
  if (!isAdminActor(actor)) return NextResponse.json({ error: actor.error }, { status: actor.status });
  try {
    const droits = await listPermissionRows();
    return NextResponse.json({ droits }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[admin/droits]", error);
    return NextResponse.json({ error: "Les droits n'ont pas pu être chargés." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const actor = await requireAdmin(request);
  if (!isAdminActor(actor)) return NextResponse.json({ error: actor.error }, { status: actor.status });
  let body: { role?: unknown; action?: unknown; niveau?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "La demande n'a pas pu être lue." }, { status: 400 });
  }
  if (!ROLES.includes(body.role as UserRole) || typeof body.action !== "string" || !isPermissionLevel(body.niveau)) {
    return NextResponse.json({ error: "Droit incomplet." }, { status: 400 });
  }
  try {
    await setPermissionLevel(body.role as UserRole, body.action, body.niveau);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[admin/droits]", error);
    return NextResponse.json({ error: "Le droit n'a pas pu être enregistré." }, { status: 500 });
  }
}
