import { supabaseForRequest } from "@/lib/server/supabase-admin";
import type { UserRole } from "@/lib/types";

export type SessionActor = {
  id: string;
  email: string;
  role: UserRole;
};

export type AdminActor = SessionActor;

export async function requireUser(
  request: Request,
): Promise<SessionActor | { error: string; status: number }> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return { error: "Session expirée. Reconnectez-vous.", status: 401 };
  }

  let admin;
  try {
    admin = supabaseForRequest(request);
  } catch {
    return {
      error: "Le service documentaire n'est pas configuré (Supabase).",
      status: 503,
    };
  }

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return { error: "Session expirée. Reconnectez-vous.", status: 401 };
  }

  const profile = await admin
    .from("users")
    .select("id, email, role, statut")
    .eq("id", data.user.id)
    .maybeSingle();

  const role = profile.data?.role;
  if (!profile.data || (role !== "administrateur" && role !== "utilisateur")) {
    return { error: "Session expirée. Reconnectez-vous.", status: 401 };
  }
  if (profile.data.statut === "suspendu") {
    return {
      error: "Ce compte est suspendu. Contactez un administrateur.",
      status: 403,
    };
  }

  return {
    id: profile.data.id,
    email: profile.data.email,
    role,
  };
}

export async function requireAdmin(
  request: Request,
): Promise<AdminActor | { error: string; status: number }> {
  const actor = await requireUser(request);
  if (!isSessionActor(actor)) return actor;
  if (actor.role !== "administrateur") {
    return {
      error: "Seuls les administrateurs peuvent gérer les accès.",
      status: 403,
    };
  }
  return actor;
}

export function isSessionActor(
  value: SessionActor | { error: string; status: number },
): value is SessionActor {
  return "id" in value && !("error" in value);
}

export function isAdminActor(
  value: AdminActor | { error: string; status: number },
): value is AdminActor {
  return isSessionActor(value);
}
