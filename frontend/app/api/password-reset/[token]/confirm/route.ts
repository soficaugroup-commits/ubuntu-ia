import { NextResponse } from "next/server";
import { confirmPasswordReset } from "@/lib/server/password-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: Context) {
  const { token } = await context.params;
  let body: { password?: string; confirmation?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  try {
    const result = await confirmPasswordReset({
      token,
      password: body.password ?? "",
      confirmation: body.confirmation ?? "",
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message, field: result.field ?? "form" },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, email: result.email });
  } catch (error) {
    console.error("[password-reset] confirm", error);
    return NextResponse.json(
      { error: "Le mot de passe n'a pas pu être mis à jour. Réessayez." },
      { status: 500 },
    );
  }
}
