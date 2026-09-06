import { DomainsWorkspace } from "@/components/admin/DomainsWorkspace";
import { RequireSession } from "@/components/auth/RequireSession";

export default function AdminDomainsPage() {
  return (
    <RequireSession>
      <DomainsWorkspace />
    </RequireSession>
  );
}
