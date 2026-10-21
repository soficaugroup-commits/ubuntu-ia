/** GET /api/admin/audit — journal immuable. */
import { NextResponse } from "next/server";
import { listAudit } from "@/lib/server/permissions-store";
import { isAdminActor, requireAdmin } from "@/lib/server/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const actor = await requireAdmin(request);
  if (!isAdminActor(actor)) return NextResponse.json({ error: actor.error }, { status: actor.status });
  try {
    const journal = await listAudit();
    return NextResponse.json({ journal }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[admin/audit]", error);
    return NextResponse.json({ error: "Le journal n'a pas pu être chargé." }, { status: 500 });
  }
}
