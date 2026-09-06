import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireServerSupabase } from "@/lib/server/env";

let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    const { url, key } = requireServerSupabase();
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
