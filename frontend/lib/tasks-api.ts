import { supabaseBrowser } from "@/lib/supabase";
import type { AgentTask } from "@/lib/types";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = supabaseBrowser();
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readBody<T>(response: Response): Promise<T & { error?: string }> {
  return (await response.json().catch(() => ({}))) as T & { error?: string };
}

export async function loadTasks(): Promise<Result<{ taches: AgentTask[] }>> {
  const response = await fetch("/api/taches", { cache: "no-store", headers: await authHeaders() });
  const body = await readBody<{ taches?: AgentTask[] }>(response);
  if (!response.ok) return { ok: false, error: body.error || "Les tâches n'ont pas pu être chargées." };
  return { ok: true, taches: body.taches ?? [] };
}

export async function loadTask(id: string): Promise<Result<{ tache: AgentTask }>> {
  const response = await fetch(`/api/taches/${id}`, { cache: "no-store", headers: await authHeaders() });
  const body = await readBody<{ tache?: AgentTask }>(response);
  if (!response.ok || !body.tache) return { ok: false, error: body.error || "Tâche introuvable." };
  return { ok: true, tache: body.tache };
}

export async function acceptTaskPlan(id: string): Promise<Result<{ tache: AgentTask }>> {
  return postTask(id, "plan", { action: "valider" });
}

export async function replyToTask(id: string, reponse: string): Promise<Result<{ tache: AgentTask }>> {
  return postTask(id, "repondre", { reponse });
}

export async function approveTaskStep(id: string, ordre: number): Promise<Result<{ tache: AgentTask }>> {
  return postTask(id, "valider-etape", { ordre });
}

export async function cancelAgentTask(id: string): Promise<Result<{ tache: AgentTask }>> {
  return postTask(id, "annuler", {});
}

export async function advanceAgentTask(id: string): Promise<Result<object>> {
  const response = await fetch(`/api/taches/${id}/avancer`, {
    method: "POST",
    cache: "no-store",
    headers: await authHeaders(),
  });
  if (!response.ok) {
    const body = await readBody<object>(response);
    return { ok: false, error: body.error || "La tâche n'a pas pu avancer." };
  }
  await response.text().catch(() => "");
  return { ok: true };
}

async function postTask(id: string, action: string, payload: Record<string, unknown>): Promise<Result<{ tache: AgentTask }>> {
  const response = await fetch(`/api/taches/${id}/${action}`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  const body = await readBody<{ tache?: AgentTask }>(response);
  if (!response.ok || !body.tache) return { ok: false, error: body.error || "L'action n'a pas abouti." };
  return { ok: true, tache: body.tache };
}
