import { NextResponse } from "next/server";
import { assertServerSecrets } from "@/lib/server/env";
import { requestPasswordReset } from "@/lib/server/password-reset";

void process.env.RESEND_API_KEY;
void process.env.RESEND_FROM_EMAIL;
void process.env.NEXT_PUBLIC_APP_URL;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const configured = assertServerSecrets();
  if (configured) {
    return NextResponse.json({ error: configured }, { status: 503 });
  }

  let body: { email?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  try {
    const result = await requestPasswordReset({
      request,
      email: body.email ?? "",
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message, field: result.code === "email" ? "email" : "form" },
        { status: result.code === "locked" ? 429 : 400 },
      );
    }
    return NextResponse.json({ ok: true, message: result.message });
  } catch (error) {
    console.error("[password-reset] request", error);
    return NextResponse.json(
      { error: "La demande n'a pas pu être traitée. Réessayez plus tard." },
      { status: 500 },
    );
  }
}
