import type { MicrosoftConfig } from "@/lib/server/connectors/microsoft";
import { OUTLOOK_SCOPES } from "@/lib/server/connectors/microsoft";

export type TokenBundle = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  account: string;
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export async function exchangeCode(
  config: MicrosoftConfig,
  code: string,
  verifier: string,
  fetchImpl: Fetcher = fetch,
): Promise<TokenBundle> {
  const token = await requestToken(config, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: config.redirectUri,
  }, fetchImpl);
  const account = await accountOf(token.accessToken, fetchImpl);
  return { ...token, account };
}

export async function refreshAccess(
  config: MicrosoftConfig,
  refreshToken: string,
  fetchImpl: Fetcher = fetch,
): Promise<Omit<TokenBundle, "account">> {
  return requestToken(config, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);
}

async function requestToken(
  config: MicrosoftConfig,
  fields: Record<string, string>,
  fetchImpl: Fetcher,
): Promise<Omit<TokenBundle, "account">> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: OUTLOOK_SCOPES.join(" "),
    ...fields,
  });
  const response = await fetchImpl(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };
  if (!response.ok || typeof payload.access_token !== "string") {
    console.error("[outlook] jeton", response.status);
    throw new Error("Microsoft n'a pas délivré de jeton.");
  }
  const seconds = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : fields.refresh_token ?? "",
    expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
  };
}

async function accountOf(token: string, fetchImpl: Fetcher): Promise<string> {
  const response = await fetchImpl("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = (await response.json().catch(() => ({}))) as { mail?: unknown; userPrincipalName?: unknown };
  if (typeof payload.mail === "string" && payload.mail) return payload.mail;
  if (typeof payload.userPrincipalName === "string") return payload.userPrincipalName;
  return "";
}
