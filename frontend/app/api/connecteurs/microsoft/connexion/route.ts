/** GET /api/connecteurs/microsoft/connexion — démarre OAuth (code + PKCE). */
import { NextResponse } from "next/server";
import { outlookStatus } from "@/lib/server/connectors/connexions";
import { authorizeUrl, createPkce, microsoftConfig, sealOauthState } from "@/lib/server/connectors/microsoft";
import { isSessionActor, requireUser } from "@/lib/server/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await requireUser(request);
  if (!isSessionActor(actor)) return NextResponse.json({ error: actor.error }, { status: actor.status });
  const config = microsoftConfig();
  if (!config) {
    return NextResponse.json(
      {
        error:
          "Les identifiants Microsoft ne sont pas renseignés (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_REDIRECT_URI, CONNECTOR_ENCRYPTION_KEY).",
      },
      { status: 503 },
    );
  }
  const status = await outlookStatus(actor.id).catch(() => null);
  if (!status?.active) {
    return NextResponse.json(
      { error: "Le connecteur Outlook n'est pas activé pour votre organisation." },
      { status: 403 },
    );
  }
  const pkce = createPkce();
  const state = sealOauthState(actor.id, pkce.verifier, config.encryptionKey);
  return NextResponse.json({ url: authorizeUrl(config, pkce.challenge, state) });
}
