import { AuditWorkspace } from "@/components/admin/AuditWorkspace";
import { RequireSession } from "@/components/auth/RequireSession";

export default function AdminAuditPage() {
  return (
    <RequireSession>
      <AuditWorkspace />
    </RequireSession>
  );
}
