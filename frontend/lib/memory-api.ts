import { supabaseBrowser } from "@/lib/supabase";
import type { MemoryFact } from "@/lib/types";

async function authHeaders(): Promise<HeadersInit> {
  const supabase = supabaseBrowser();
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function loadMemory(): Promise<
  { ok: true; facts: MemoryFact[] } | { ok: false; error: string }
> {
  const response = await fetch("/api/memory", {
    cache: "no-store",
    headers: await authHeaders(),
  });
  const body = (await response.json().catch(() => ({}))) as {
    facts?: MemoryFact[];
    error?: string;
  };
  if (!response.ok) {
    return { ok: false, error: body.error || "La mémoire n'a pas pu être chargée." };
  }
  return { ok: true, facts: body.facts ?? [] };
}

export async function deleteMemory(id: string): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const response = await fetch(`/api/memory/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    return { ok: false, error: body.error || "Ce souvenir n'a pas pu être supprimé." };
  }
  return { ok: true };
}
