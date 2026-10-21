/** GET /api/connecteurs/microsoft/callback — échange le code, sans exposer les jetons. */
import { NextResponse } from "next/server";
import { saveMicrosoftTokens } from "@/lib/server/connectors/connexions";
import { microsoftConfig, openOauthState } from "@/lib/server/connectors/microsoft";
import { exchangeCode } from "@/lib/server/connectors/microsoft-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = new URL("/reglages", url.origin);
  const config = microsoftConfig();
  if (!config) {
    back.searchParams.set("outlook", "non-configure");
    return NextResponse.redirect(back);
  }
  const code = url.searchParams.get("code") ?? "";
  const state = openOauthState(url.searchParams.get("state") ?? "", config.encryptionKey);
  if (!code || !state) {
    back.searchParams.set("outlook", "refuse");
    return NextResponse.redirect(back);
  }
  try {
    const bundle = await exchangeCode(config, code, state.verifier);
    await saveMicrosoftTokens(state.userId, bundle, config.encryptionKey);
    back.searchParams.set("outlook", "connecte");
  } catch (error) {
    console.error("[outlook] callback", error);
    back.searchParams.set("outlook", "erreur");
  }
  return NextResponse.redirect(back);
}
