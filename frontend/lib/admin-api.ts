import { supabaseBrowser } from "@/lib/supabase";

async function authHeaders(): Promise<HeadersInit> {
  const supabase = supabaseBrowser();
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function adminGet<T>(path: string): Promise<
  { ok: true; data: T } | { ok: false; error: string }
> {
  const response = await fetch(path, {
    cache: "no-store",
    headers: await authHeaders(),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: body.error || "La requête n'a pas abouti." };
  }
  return { ok: true, data: body as T };
}

export async function adminPost<T>(
  path: string,
  payload: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: string; field?: string }> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      error: body.error || "La requête n'a pas abouti.",
      field: body.field,
    };
  }
  return { ok: true, data: body as T };
}

export async function adminPostForm<T>(
  path: string,
  form: FormData,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const response = await fetch(path, {
    method: "POST",
    headers: await authHeaders(),
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: body.error || "La requête n'a pas abouti." };
  }
  return { ok: true, data: body as T };
}

export async function adminDelete<T>(
  path: string,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const response = await fetch(path, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: body.error || "La requête n'a pas abouti." };
  }
  return { ok: true, data: body as T };
}
