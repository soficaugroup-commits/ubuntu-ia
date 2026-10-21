import { TemplatesWorkspace } from "@/components/admin/TemplatesWorkspace";
import { RequireSession } from "@/components/auth/RequireSession";

export default function AdminTemplatesPage() {
  return (
    <RequireSession>
      <TemplatesWorkspace />
    </RequireSession>
  );
}
