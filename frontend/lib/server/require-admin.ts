import { supabaseAdmin } from "@/lib/server/supabase-admin";
import type { UserRole } from "@/lib/types";

export type AdminActor = {
  id: string;
  email: string;
  role: UserRole;
};

export async function requireAdmin(
  request: Request,
): Promise<AdminActor | { error: string; status: number }> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return { error: "Session expirée. Reconnectez-vous.", status: 401 };
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return { error: "Session expirée. Reconnectez-vous.", status: 401 };
  }

  const profile = await admin
    .from("users")
    .select("id, email, role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile.data || profile.data.role !== "administrateur") {
    return {
      error: "Seuls les administrateurs peuvent gérer les accès.",
      status: 403,
    };
  }

  return {
    id: profile.data.id,
    email: profile.data.email,
    role: "administrateur",
  };
}

export function isAdminActor(
  value: AdminActor | { error: string; status: number },
): value is AdminActor {
  return "id" in value && !("error" in value);
}
