import { AsyncLocalStorage } from "node:async_hooks";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  requireServerSupabase,
  supabaseServiceKey,
  supabaseUrl,
} from "@/lib/server/env";

const requestStore = new AsyncLocalStorage<SupabaseClient>();

let serviceClient: SupabaseClient | null = null;

function createServiceClient(): SupabaseClient {
  if (!serviceClient) {
    const { url, key } = requireServerSupabase();
    serviceClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return serviceClient;
}

export function supabaseAdmin(): SupabaseClient {
  return requestStore.getStore() ?? createServiceClient();
}

export function supabaseForRequest(request: Request): SupabaseClient {
  if (supabaseUrl() && supabaseServiceKey()) {
    return createServiceClient();
  }
  const token = (request.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  const url = supabaseUrl() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
  if (!url || !anon || !token) {
    throw new Error("Supabase serveur manquant.");
  }
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function withDocumentsClient<T>(
  request: Request,
  fn: () => Promise<T>,
): Promise<T> {
  return requestStore.run(supabaseForRequest(request), fn);
}
