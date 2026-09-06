import { RequireSession } from "@/components/auth/RequireSession";
import { ChatWorkspace } from "@/components/chat/ChatWorkspace";

export default function ChatPage() {
  return (
    <RequireSession>
      <ChatWorkspace />
    </RequireSession>
  );
}
