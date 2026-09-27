import "server-only";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

const DEFAULT_DAILY_MESSAGES = 200;

export async function assertMessageQuota(userId: string): Promise<string | null> {
  try {
    const client = supabaseAdmin();
    const { data: profile } = await client
      .from("users")
      .select("organisation_id")
      .eq("id", userId)
      .maybeSingle();
    const orgId = profile?.organisation_id as string | undefined;
    let limit = DEFAULT_DAILY_MESSAGES;
    if (orgId) {
      const { data: org } = await client
        .from("organisations")
        .select("quota_messages_jour")
        .eq("id", orgId)
        .maybeSingle();
      const configured = org?.quota_messages_jour;
      if (typeof configured === "number" && configured > 0) limit = configured;
    }
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const { count, error } = await client
      .from("usage_journalier")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", "message")
      .gte("created_at", start.toISOString());
    if (error) return null;
    if ((count ?? 0) >= limit) {
      return `Quota quotidien atteint (${limit} messages). Un administrateur peut relever le forfait.`;
    }
    return null;
  } catch {
    return null;
  }
}

export async function recordMessageUse(userId: string): Promise<void> {
  try {
    await supabaseAdmin().from("usage_journalier").insert({
      user_id: userId,
      kind: "message",
    });
  } catch {
    // La table est créée par la migration 014. Sans elle, le chat continue.
  }
}
