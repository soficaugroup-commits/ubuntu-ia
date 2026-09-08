/**
 * GET /api/admin/feedback?type=negatif|positif|tous
 * Liste les retours pour revue périodique du prompt système (administrateurs).
 * Par défaut : retours négatifs récents, avec extraits de question et de réponse.
 */
import { NextResponse } from "next/server";
import { listAdminFeedback } from "@/lib/server/feedback";
import { assertDocumentSecrets } from "@/lib/server/env";
import { isAdminActor, requireAdmin } from "@/lib/server/require-admin";
import type { FeedbackType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function asFilter(value: string | null): FeedbackType | "tous" {
  if (value === "positif" || value === "negatif" || value === "tous") return value;
  return "negatif";
}

export async function GET(request: Request) {
  const configured = assertDocumentSecrets();
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 503 });
  }

  const actor = await requireAdmin(request);
  if (!isAdminActor(actor)) {
    return NextResponse.json({ error: actor.error }, { status: actor.status });
  }

  const type = asFilter(new URL(request.url).searchParams.get("type"));
  try {
    const items = await listAdminFeedback(type);
    return NextResponse.json(
      { feedbacks: items },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Les retours n'ont pas pu être chargés." },
      { status: 500 },
    );
  }
}
