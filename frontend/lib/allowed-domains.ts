import { supabaseBrowser } from "@/lib/supabase";
import type { AllowedDomain } from "@/lib/domains";

export async function listAllowedDomains(): Promise<AllowedDomain[] | null> {
  const supabase = supabaseBrowser();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("domaines_autorises")
    .select("id, domaine, date_ajout")
    .order("domaine");
  if (error) return null;
  return data ?? [];
}

export async function addAllowedDomain(domaine: string): Promise<
  | { ok: true; domain: AllowedDomain }
  | { ok: false; code: "duplicate" | "invalid" | "unavailable" }
> {
  const supabase = supabaseBrowser();
  if (!supabase) return { ok: false, code: "unavailable" };
  const { data, error } = await supabase
    .from("domaines_autorises")
    .insert({ domaine })
    .select("id, domaine, date_ajout")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, code: "duplicate" };
    if (error.code === "23514") return { ok: false, code: "invalid" };
    return { ok: false, code: "unavailable" };
  }
  return { ok: true, domain: data };
}

export async function removeAllowedDomain(
  id: string,
): Promise<{ ok: true } | { ok: false; code: "last" | "unavailable" }> {
  const supabase = supabaseBrowser();
  if (!supabase) return { ok: false, code: "unavailable" };
  const { error } = await supabase.from("domaines_autorises").delete().eq("id", id);
  if (error) {
    if (error.message.includes("au moins un domaine")) {
      return { ok: false, code: "last" };
    }
    return { ok: false, code: "unavailable" };
  }
  return { ok: true };
}
