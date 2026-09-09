import { NextResponse } from "next/server";
import { readPasswordReset } from "@/lib/server/password-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context) {
  const { token } = await context.params;
  try {
    const result = await readPasswordReset(token);
    if (!result.ok) {
      return NextResponse.json({ status: result.status }, { status: 400 });
    }
    return NextResponse.json({
      email: result.email,
      prenom: result.prenom,
      nom: result.nom,
    });
  } catch (error) {
    console.error("[password-reset] read", error);
    return NextResponse.json({ status: "invalid" }, { status: 500 });
  }
}
