export function supabaseUrl(): string {
  return (
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    ""
  );
}

export function supabaseServiceKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
}

export function resendApiKey(): string {
  return process.env.RESEND_API_KEY?.trim() || "";
}

export function resendFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || "";
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
  const personal =
    process.env.UBUNTU_OPENROUTER_API_KEY?.trim() ||
    (isPersonalOpenRouterKey(process.env.OPENROUTER_API_KEY?.trim() || "")
      ? process.env.OPENROUTER_API_KEY!.trim()
      : "");
  if (personal) {
    return { key: personal, baseUrl: OPENROUTER_OFFICIAL_BASE };
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim() || "";
  const openRouterBase = trimSlash(process.env.OPENROUTER_BASE_URL?.trim() || "");
  if (openRouterKey && openRouterBase && !isOfficialOpenRouterBase(openRouterBase)) {
    return { key: openRouterKey, baseUrl: openRouterBase };
  }

  const gatewayKey = process.env.NETLIFY_AI_GATEWAY_KEY?.trim() || "";
  const gatewayBase = trimSlash(process.env.NETLIFY_AI_GATEWAY_BASE_URL?.trim() || "");
  if (gatewayKey && gatewayBase) {
    return { key: gatewayKey, baseUrl: gatewayBase };
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim() || "";
  const openaiBase = trimSlash(process.env.OPENAI_BASE_URL?.trim() || "");
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
      process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://ubuntu-ia.com",
    "X-Title": "Ubuntu IA",
  };
}

export function visionModel(): string {
  return process.env.VISION_MODEL?.trim() || "openai/gpt-4o-mini";
}

export function appUrl(request: Request): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

export function assertDocumentSecrets(): string | null {
  if (!supabaseUrl() && !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
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
