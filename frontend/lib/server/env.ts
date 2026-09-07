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

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function openrouterApiKey(): string {
  return process.env.OPENROUTER_API_KEY?.trim() || "";
}

export function requireOpenRouterKey(): string {
  const key = openrouterApiKey();
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY n'est pas configurée. Dans Netlify, ajoutez votre clé OpenRouter personnelle (sk-or-v1-…).",
    );
  }
  if (!key.startsWith("sk-or-v1-")) {
    throw new Error(
      "Netlify a injecté la clé de sa passerelle IA, inutilisable pour l'indexation. Dans Netlify → Environment variables, définissez OPENROUTER_API_KEY avec votre clé OpenRouter (sk-or-v1-…), puis redéployez.",
    );
  }
  return key;
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
