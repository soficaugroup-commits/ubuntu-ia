import "server-only";
import type { TaskStore } from "@/lib/server/agent-loop/runner";
import { claimTask, getTaskForUser, persistTask, releaseTask } from "@/lib/server/tasks";

/** Magasin Supabase branché sur le runner : une sauvegarde après chaque étape. */
export function supabaseTaskStore(userId: string): TaskStore {
  return {
    load: (id) => getTaskForUser(userId, id),
    save: (task) => persistTask(userId, task),
    claim: (id, until) => claimTask(id, until),
    release: (id) => releaseTask(id),
  };
}
