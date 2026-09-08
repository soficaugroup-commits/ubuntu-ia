import { FeedbackWorkspace } from "@/components/admin/FeedbackWorkspace";
import { RequireSession } from "@/components/auth/RequireSession";

export default function AdminFeedbackPage() {
  return (
    <RequireSession>
      <FeedbackWorkspace />
    </RequireSession>
  );
}
