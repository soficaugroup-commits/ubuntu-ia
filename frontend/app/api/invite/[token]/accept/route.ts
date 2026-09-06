import { NextResponse } from "next/server";
import { acceptInvitation } from "@/lib/server/invitations";

type Context = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: Context) {
  const { token } = await context.params;
  let body: { password?: string; confirmation?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const result = await acceptInvitation({
    token,
    password: body.password ?? "",
    confirmation: body.confirmation ?? "",
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, field: result.code },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, email: result.email });
}
