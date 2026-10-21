import { createHash, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/server/crypto";

export const OUTLOOK_SCOPES = ["offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send"] as const;

export type MicrosoftConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
};

/** Config présente seulement si les cinq variables sont renseignées. Jamais de valeur par défaut. */
export function microsoftConfig(): MicrosoftConfig | null {
  const tenantId = process.env.MS_TENANT_ID?.trim() ?? "";
  const clientId = process.env.MS_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.MS_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = process.env.MS_REDIRECT_URI?.trim() ?? "";
  const encryptionKey = process.env.CONNECTOR_ENCRYPTION_KEY?.trim() ?? "";
  if (!tenantId || !clientId || !clientSecret || !redirectUri || !encryptionKey) return null;
  return { tenantId, clientId, clientSecret, redirectUri, encryptionKey };
}

export function outlookEnabled(fonctionnalites: unknown): boolean {
  if (!fonctionnalites || typeof fonctionnalites !== "object") return false;
  return (fonctionnalites as { outlook?: unknown }).outlook === true;
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

type SealedState = { userId: string; verifier: string; exp: number };

export function sealOauthState(userId: string, verifier: string, key: string, now = Date.now()): string {
  const payload: SealedState = { userId, verifier, exp: now + 10 * 60_000 };
  return encryptSecret(JSON.stringify(payload), key);
}

export function openOauthState(state: string, key: string, now = Date.now()): SealedState | null {
  try {
    const parsed = JSON.parse(decryptSecret(state, key)) as Partial<SealedState>;
    if (!parsed.userId || !parsed.verifier || typeof parsed.exp !== "number") return null;
    if (parsed.exp <= now) return null;
    return { userId: parsed.userId, verifier: parsed.verifier, exp: parsed.exp };
  } catch {
    return null;
  }
}

export function authorizeUrl(config: MicrosoftConfig, challenge: string, state: string): string {
  const url = new URL(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", OUTLOOK_SCOPES.join(" "));
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}
