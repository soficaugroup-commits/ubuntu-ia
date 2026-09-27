import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { env as nodeEnv } from "node:process";

function cleanEnv(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^["']|["']$/g, "")
    .replace(/^Bearer\s+/i, "");
}

/**
 * Next n'inline que les accès statiques `process.env.NOM`.
 * Un accès `process.env[nom]` reste vide, et le `.env` du dépôt est à la racine,
 * pas dans `frontend/` où tourne le serveur.
 */
function staticEnv(name: string): string | undefined {
  switch (name) {
    case "OPENROUTER_API_KEY":
      return process.env.OPENROUTER_API_KEY;
    case "UBUNTU_OPENROUTER_API_KEY":
      return process.env.UBUNTU_OPENROUTER_API_KEY;
    case "OPENROUTER_BASE_URL":
      return process.env.OPENROUTER_BASE_URL;
    case "NETLIFY_AI_GATEWAY_KEY":
      return process.env.NETLIFY_AI_GATEWAY_KEY;
    case "NETLIFY_AI_GATEWAY_BASE_URL":
      return process.env.NETLIFY_AI_GATEWAY_BASE_URL;
    case "OPENAI_API_KEY":
      return process.env.OPENAI_API_KEY;
    case "OPENAI_BASE_URL":
      return process.env.OPENAI_BASE_URL;
    case "EMBEDDING_MODEL":
      return process.env.EMBEDDING_MODEL;
    case "CHAT_MODEL":
      return process.env.CHAT_MODEL;
    case "FILE_MODEL":
      return process.env.FILE_MODEL;
    case "DOCUMENT_MODEL":
      return process.env.DOCUMENT_MODEL;
    case "IMAGE_MODEL":
      return process.env.IMAGE_MODEL;
    case "VISION_MODEL":
      return process.env.VISION_MODEL;
    case "REALTIME_MODEL":
      return process.env.REALTIME_MODEL;
    case "REALTIME_VOICE":
      return process.env.REALTIME_VOICE;
    case "VOICE_STT_MODEL":
      return process.env.VOICE_STT_MODEL;
    case "SUPABASE_URL":
      return process.env.SUPABASE_URL;
    case "NEXT_PUBLIC_SUPABASE_URL":
      return process.env.NEXT_PUBLIC_SUPABASE_URL;
    case "SUPABASE_SERVICE_ROLE_KEY":
      return process.env.SUPABASE_SERVICE_ROLE_KEY;
    case "RESEND_API_KEY":
      return process.env.RESEND_API_KEY;
    case "RESEND_FROM_EMAIL":
      return process.env.RESEND_FROM_EMAIL;
    case "NEXT_PUBLIC_APP_URL":
      return process.env.NEXT_PUBLIC_APP_URL;
    case "APP_URL":
      return process.env.APP_URL;
    default:
      return undefined;
  }
}

const fileEnv = new Map<string, string>();
let fileEnvLoaded = false;

function ensureFileEnv(): void {
  if (fileEnvLoaded) return;
  fileEnvLoaded = true;
  const files = [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "..", ".env"),
  ];
  for (const file of files) {
    if (!existsSync(file)) continue;
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!key || fileEnv.has(key) || cleanEnv(nodeEnv[key])) continue;
      const value = cleanEnv(trimmed.slice(eq + 1));
      if (!value) continue;
      fileEnv.set(key, value);
      try {
        nodeEnv[key] = value;
      } catch {
        // process.env peut être figé par le bundler.
      }
    }
  }
}

function runtimeEnv(name: string): string {
  // Accès indirect : le bundler ne peut pas figer la valeur au moment du build.
  // En production, Render injecte les secrets dans le processus, pas dans un fichier.
  const bucket = globalThis.process?.env as Record<string, string | undefined> | undefined;
  return cleanEnv(bucket?.[name]) || cleanEnv(nodeEnv[name]);
}

function liveEnv(name: string): string {
  ensureFileEnv();
  return (
    runtimeEnv(name) ||
    cleanEnv(staticEnv(name)) ||
    cleanEnv(fileEnv.get(name))
  );
}

export function supabaseUrl(): string {
  return liveEnv("SUPABASE_URL") || liveEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function supabaseServiceKey(): string {
  return liveEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function resendApiKey(): string {
  // Référence statique : Next/Netlify n'expose pas toujours process.env[name] dynamique.
  void process.env.RESEND_API_KEY;
  return liveEnv("RESEND_API_KEY");
}

export function resendFromEmail(): string {
  void process.env.RESEND_FROM_EMAIL;
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
    void process.env.CHAT_MODEL;
    void process.env.FILE_MODEL;
    void process.env.DOCUMENT_MODEL;
    void process.env.IMAGE_MODEL;
    void process.env.VISION_MODEL;
    void process.env.REALTIME_MODEL;
    void process.env.REALTIME_VOICE;
    void process.env.VOICE_STT_MODEL;

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
    "Aucun fournisseur d'embeddings n'est disponible sur le serveur. Définissez OPENROUTER_API_KEY dans l'environnement d'exécution (Render), pas seulement dans un fichier .env local.",
  );
}

export function embeddingRequest(endpoint: LlmEndpoint): {
  url: string;
  model: string;
} {
  const configured = liveEnv("EMBEDDING_MODEL");
  const official = isOfficialOpenRouterBase(endpoint.baseUrl);
  const model =
    configured ||
    (official || endpoint.baseUrl.includes("openrouter")
      ? "openai/text-embedding-3-small"
      : "text-embedding-3-small");
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

export function chatModel(endpoint: LlmEndpoint): string {
  return chatModelCandidates(endpoint)[0];
}

export function chatModelCandidates(endpoint: LlmEndpoint): string[] {
  const configured = liveEnv("CHAT_MODEL");
  const official =
    isOfficialOpenRouterBase(endpoint.baseUrl) ||
    endpoint.baseUrl.includes("openrouter");
  const primary =
    configured ||
    (official ? "~deepseek/deepseek-flash-latest" : "deepseek-v4.1-flash");
  const fallbacks = official
    ? ["deepseek/deepseek-v4.1-flash", "deepseek/deepseek-v4-flash"]
    : ["deepseek-v4.1-flash", "deepseek-chat"];
  return [primary, ...fallbacks.filter((item) => item !== primary)];
}

/**
 * Modèle dédié à la rédaction / mise en forme / design des livrables
 * (Word, Excel, PowerPoint, PDF, canevas documentaire).
 * Défaut : le dernier Claude (alias OpenRouter), aujourd'hui Opus 5.5.
 */
export function fileModel(endpoint: LlmEndpoint): string {
  return fileModelCandidates(endpoint)[0];
}

export function fileModelCandidates(endpoint: LlmEndpoint): string[] {
  const configured = liveEnv("FILE_MODEL") || liveEnv("DOCUMENT_MODEL");
  const official =
    isOfficialOpenRouterBase(endpoint.baseUrl) ||
    endpoint.baseUrl.includes("openrouter");
  const primary = configured || (official ? "~anthropic/claude-opus-latest" : "claude-opus-5.5");
  const fallbacks = official
    ? ["anthropic/claude-opus-5.5", "anthropic/claude-fable-5.1"]
    : ["claude-opus-5.5", "claude-fable-5-1"];
  return [primary, ...fallbacks.filter((item) => item !== primary)];
}

export function imageModel(endpoint: LlmEndpoint): string {
  return imageModelCandidates(endpoint)[0];
}

export function imageModelCandidates(endpoint: LlmEndpoint): string[] {
  const configured = liveEnv("IMAGE_MODEL");
  const official =
    isOfficialOpenRouterBase(endpoint.baseUrl) ||
    endpoint.baseUrl.includes("openrouter");
  const primary = configured || (official ? "openai/gpt-image-2.5-sunburst" : "gpt-image-2.5-sunburst");
  const fallbacks = ["openai/gpt-image-2.5-flare", "openai/gpt-image-2"];
  return [primary, ...fallbacks.filter((item) => item !== primary)];
}

export function imagesUrl(endpoint: LlmEndpoint): string {
  return `${endpoint.baseUrl}/images`;
}

export function transcriptionsUrl(endpoint: LlmEndpoint): string {
  return `${endpoint.baseUrl}/audio/transcriptions`;
}

export function realtimeModel(): string {
  return liveEnv("REALTIME_MODEL") || "openai/gpt-audio-mini";
}

export function voiceSttModel(): string {
  return liveEnv("VOICE_STT_MODEL") || "openai/whisper-1";
}

export function realtimeVoice(): string {
  return liveEnv("REALTIME_VOICE") || "alloy";
}

export function assertRealtimeSecrets(): string | null {
  try {
    resolveLlmEndpoint();
    return null;
  } catch {
    return "Le mode vocal n'est pas configuré (OPENROUTER_API_KEY).";
  }
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
  const key = resendApiKey();
  const from = resendFromEmail();
  if (!key && !from) {
    return "L'envoi d'e-mail n'est pas configuré (RESEND_API_KEY et RESEND_FROM_EMAIL manquants sur Netlify).";
  }
  if (!key) {
    return "L'envoi d'e-mail n'est pas configuré (RESEND_API_KEY manquante sur Netlify).";
  }
  if (!from) {
    return "L'envoi d'e-mail n'est pas configuré (RESEND_FROM_EMAIL manquante sur Netlify).";
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
