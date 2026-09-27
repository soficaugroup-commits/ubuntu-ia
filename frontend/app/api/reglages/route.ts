import { NextResponse } from "next/server";
import { isSessionActor, requireUser } from "@/lib/server/require-admin";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export async function GET(request: Request) {
  const actor = await requireUser(request);
  if (!isSessionActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }
  const client = supabaseAdmin();
  const profile = await client
    .from("users")
    .select("organisation_id, role")
    .eq("id", actor.id)
    .maybeSingle();
  const orgId = profile.data?.organisation_id as string | null;
  let organisation = "SOFICAU UBUNTU GROUP";
  let quota = 200;
  if (orgId) {
    const org = await client
      .from("organisations")
      .select("nom, quota_messages_jour")
      .eq("id", orgId)
      .maybeSingle();
    if (org.data?.nom) organisation = String(org.data.nom);
    if (typeof org.data?.quota_messages_jour === "number") {
      quota = org.data.quota_messages_jour;
    }
  }
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const usage = await client
    .from("usage_journalier")
    .select("id", { count: "exact", head: true })
    .eq("user_id", actor.id)
    .eq("kind", "message")
    .gte("created_at", start.toISOString());
  return NextResponse.json({
    organisation,
    organisationId: orgId,
    quota,
    used: usage.count ?? 0,
    role: actor.role,
  });
}

export async function PATCH(request: Request) {
  const actor = await requireUser(request);
  if (!isSessionActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }
  if (actor.role !== "administrateur") {
    return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { quota?: number } | null;
  const quota = Number(body?.quota);
  if (!Number.isFinite(quota) || quota < 1 || quota > 10000) {
    return NextResponse.json({ error: "Indiquez un quota entre 1 et 10 000." }, { status: 400 });
  }
  const profile = await supabaseAdmin()
    .from("users")
    .select("organisation_id")
    .eq("id", actor.id)
    .maybeSingle();
  const orgId = profile.data?.organisation_id as string | null;
  if (!orgId) {
    return NextResponse.json(
      { error: "Aucune organisation n'est encore enregistrée. Appliquez la migration 014." },
      { status: 409 },
    );
  }
  const { error } = await supabaseAdmin()
    .from("organisations")
    .update({ quota_messages_jour: Math.round(quota) })
    .eq("id", orgId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, quota: Math.round(quota) });
}
