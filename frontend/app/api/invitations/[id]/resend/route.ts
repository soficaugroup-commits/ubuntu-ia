import { NextResponse } from "next/server";
import { assertServerSecrets } from "@/lib/server/env";
import { resendInvitation } from "@/lib/server/invitations";
import { isAdminActor, requireAdmin } from "@/lib/server/require-admin";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const configured = assertServerSecrets();
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 503 });
  }

  const actor = await requireAdmin(request);
  if (!isAdminActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  const { id } = await context.params;
  const result = await resendInvitation(request, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
