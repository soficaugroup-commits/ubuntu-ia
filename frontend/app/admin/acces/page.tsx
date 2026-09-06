import { AccessWorkspace } from "@/components/admin/AccessWorkspace";
import { RequireSession } from "@/components/auth/RequireSession";

export default function AdminAccessPage() {
  return (
    <RequireSession>
      <AccessWorkspace />
    </RequireSession>
  );
}
