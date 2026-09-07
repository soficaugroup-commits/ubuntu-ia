import "server-only";

function readEnv(name: string): string {
  return process.env[name]?.trim() || "";
}

export function supabaseUrl(): string {
  return readEnv("SUPABASE_URL") || readEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function supabaseServiceKey(): string {
  return readEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function resendApiKey(): string {
  return readEnv("RESEND_API_KEY");
}

export function resendFromEmail(): string {
  return readEnv("RESEND_FROM_EMAIL");
}

export const OPENROUTER_OFFICIAL_BASE = "https://openrouter.ai/api/v1";

export type LlmEndpoint = {
  key: string;
  baseUrl: string;
};

function trimSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function isPersonalOpenRouterKey(key: string): boolean {
  return key.startsWith("sk-or-v1-");
}

function isOfficialOpenRouterBase(url: string): boolean {
  return /openrouter\.ai/i.test(url);
}

export function resolveLlmEndpoint(): LlmEndpoint {
  const personalKey = readEnv("UBUNTU_OPENROUTER_API_KEY") || readEnv("OPENROUTER_API_KEY");
  if (isPersonalOpenRouterKey(personalKey)) {
    return { key: personalKey, baseUrl: OPENROUTER_OFFICIAL_BASE };
  }

  const openRouterKey = readEnv("OPENROUTER_API_KEY");
  const openRouterBase = trimSlash(readEnv("OPENROUTER_BASE_URL"));
  if (openRouterKey && openRouterBase && !isOfficialOpenRouterBase(openRouterBase)) {
    return { key: openRouterKey, baseUrl: openRouterBase };
  }

  const gatewayKey = readEnv("NETLIFY_AI_GATEWAY_KEY");
  const gatewayBase = trimSlash(readEnv("NETLIFY_AI_GATEWAY_BASE_URL"));
  if (gatewayKey && gatewayBase) {
    return { key: gatewayKey, baseUrl: gatewayBase };
  }

  const openaiKey = readEnv("OPENAI_API_KEY");
  const openaiBase = trimSlash(readEnv("OPENAI_BASE_URL"));
  if (openaiKey && openaiBase) {
    return { key: openaiKey, baseUrl: openaiBase };
  }

  throw new Error(
    "Aucun fournisseur d'embeddings n'est disponible sur le serveur.",
  );
}

export function embeddingRequest(endpoint: LlmEndpoint): {
  url: string;
  model: string;
} {
  const official = isOfficialOpenRouterBase(endpoint.baseUrl);
  const model = official
    ? "openai/text-embedding-3-small"
    : endpoint.baseUrl.includes("openrouter")
      ? "openai/text-embedding-3-small"
      : "text-embedding-3-small";
  return {
    url: `${endpoint.baseUrl}/embeddings`,
    model,
  };
}

export function chatCompletionsUrl(endpoint: LlmEndpoint): string {
  return `${endpoint.baseUrl}/chat/completions`;
}

export function openrouterApiKey(): string {
  return resolveLlmEndpoint().key;
}

export function requireOpenRouterKey(): string {
  return resolveLlmEndpoint().key;
}

export function openRouterHeaders(key: string): HeadersInit {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer":
      readEnv("NEXT_PUBLIC_APP_URL") || "https://ubuntu-ia.com",
    "X-Title": "Ubuntu IA",
  };
}

export function visionModel(): string {
  return readEnv("VISION_MODEL") || "openai/gpt-4o-mini";
}

export function appUrl(request: Request): string {
  const configured = readEnv("NEXT_PUBLIC_APP_URL") || readEnv("APP_URL");
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

export function assertDocumentSecrets(): string | null {
  if (!supabaseUrl()) {
    return "Le service documentaire n'est pas configuré (Supabase).";
  }
  return null;
}

export function assertSupabaseSecrets(): string | null {
  if (!supabaseUrl() || !supabaseServiceKey()) {
    return "Le service documentaire n'est pas configuré (Supabase).";
  }
  return null;
}

export function assertServerSecrets(): string | null {
  const supabase = assertSupabaseSecrets();
  if (supabase) {
    return "Le service d'invitation n'est pas configuré (Supabase).";
  }
  if (!resendApiKey() || !resendFromEmail()) {
    return "L'envoi d'e-mail n'est pas configuré (Resend).";
  }
  return null;
}

export function requireServerSupabase(): { url: string; key: string } {
  const url = supabaseUrl();
  const key = supabaseServiceKey();
  if (!url || !key) {
    throw new Error("Supabase serveur manquant.");
  }
  return { url, key };
}
