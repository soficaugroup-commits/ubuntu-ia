import "server-only";
import { env as nodeEnv } from "node:process";

function cleanEnv(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^Bearer\s+/i, "");
}

function liveEnv(name: string): string {
  return cleanEnv(nodeEnv[name]) || cleanEnv(process.env[name]);
}

export function supabaseUrl(): string {
  return liveEnv("SUPABASE_URL") || liveEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function supabaseServiceKey(): string {
  return liveEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function resendApiKey(): string {
  return liveEnv("RESEND_API_KEY");
}

export function resendFromEmail(): string {
  return liveEnv("RESEND_FROM_EMAIL");
}

function llmRuntimeVars() {
  void process.env.OPENROUTER_API_KEY;
  void process.env.OPENROUTER_BASE_URL;
  void process.env.NETLIFY_AI_GATEWAY_KEY;
  void process.env.NETLIFY_AI_GATEWAY_BASE_URL;
  void process.env.OPENAI_API_KEY;
  void process.env.OPENAI_BASE_URL;
  void process.env.UBUNTU_OPENROUTER_API_KEY;

  return {
    ubuntu: liveEnv("UBUNTU_OPENROUTER_API_KEY"),
    openrouterKey: liveEnv("OPENROUTER_API_KEY"),
    openrouterBase: trimSlash(liveEnv("OPENROUTER_BASE_URL")),
    gatewayKey: liveEnv("NETLIFY_AI_GATEWAY_KEY"),
    gatewayBase: trimSlash(liveEnv("NETLIFY_AI_GATEWAY_BASE_URL")),
    openaiKey: liveEnv("OPENAI_API_KEY"),
    openaiBase: trimSlash(liveEnv("OPENAI_BASE_URL")),
  };
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
  const env = llmRuntimeVars();

  if (isPersonalOpenRouterKey(env.ubuntu) || isPersonalOpenRouterKey(env.openrouterKey)) {
    return {
      key: isPersonalOpenRouterKey(env.ubuntu) ? env.ubuntu : env.openrouterKey,
      baseUrl: OPENROUTER_OFFICIAL_BASE,
    };
  }

  if (env.openrouterKey && env.openrouterBase && !isOfficialOpenRouterBase(env.openrouterBase)) {
    return { key: env.openrouterKey, baseUrl: env.openrouterBase };
  }

  if (env.gatewayKey && env.gatewayBase) {
    return { key: env.gatewayKey, baseUrl: env.gatewayBase };
  }

  if (env.openrouterKey && env.gatewayBase) {
    return { key: env.openrouterKey, baseUrl: env.gatewayBase };
  }

  if (env.gatewayKey && env.openrouterBase && !isOfficialOpenRouterBase(env.openrouterBase)) {
    return { key: env.gatewayKey, baseUrl: env.openrouterBase };
  }

  if (env.openaiKey && env.openaiBase) {
    return { key: env.openaiKey, baseUrl: env.openaiBase };
  }

  if (env.openrouterKey && env.openrouterBase) {
    return { key: env.openrouterKey, baseUrl: env.openrouterBase };
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
    "HTTP-Referer": liveEnv("NEXT_PUBLIC_APP_URL") || "https://ubuntu-ia.com",
    "X-Title": "Ubuntu IA",
  };
}

export function visionModel(): string {
  return liveEnv("VISION_MODEL") || "openai/gpt-4o-mini";
}

export function appUrl(request: Request): string {
  const configured = liveEnv("NEXT_PUBLIC_APP_URL") || liveEnv("APP_URL");
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
