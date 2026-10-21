import { RightsWorkspace } from "@/components/admin/RightsWorkspace";
import { RequireSession } from "@/components/auth/RequireSession";

export default function AdminRightsPage() {
  return (
    <RequireSession>
      <RightsWorkspace />
    </RequireSession>
  );
}
