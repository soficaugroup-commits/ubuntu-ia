import { AdminWorkspace } from "@/components/admin/AdminWorkspace";
import { RequireSession } from "@/components/auth/RequireSession";

export default function AdminPage() {
  return (
    <RequireSession>
      <AdminWorkspace />
    </RequireSession>
  );
}
