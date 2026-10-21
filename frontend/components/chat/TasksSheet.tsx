"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Surface } from "@/components/ui/Surface";
import { copy } from "@/content/fr";
import { advanceAgentTask, loadTask, loadTasks } from "@/lib/tasks-api";
import type { AgentTask, TaskStatus } from "@/lib/types";

const t = copy.chat.tasks;
const WAITING: TaskStatus[] = ["en_attente_utilisateur", "en_attente_validation", "plan_propose"];
const DONE: TaskStatus[] = ["terminee", "echouee", "annulee"];

export function TasksSheet() {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentTask | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadTasks().then((result) => {
      if (!alive) return;
      if (!result.ok) {
        setState("error");
        return;
      }
      setTasks(result.taches);
      setState("ready");
    });
    return () => {
      alive = false;
    };
  }, []);

  async function resume(id: string) {
    setPending(true);
    setOpenId(id);
    const current = await loadTask(id);
    if (current.ok && current.tache.statut === "en_cours") {
      await advanceAgentTask(id);
    }
    const fresh = await loadTask(id);
    setPending(false);
    if (fresh.ok) setDetail(fresh.tache);
  }

  if (state === "loading") {
    return (
      <p className="px-4 py-6 text-sm text-content-muted" role="status">
        {t.loading}
      </p>
    );
  }
  if (state === "error") {
    return <p className="px-4 py-6 text-sm text-accent-hover">{t.loadError}</p>;
  }
  if (!tasks.length) return <EmptyState title={t.emptyTitle} body={t.emptyBody} />;

  const groups = [
    { id: "waiting", label: t.groups.waiting, items: tasks.filter((item) => WAITING.includes(item.statut)) },
    { id: "active", label: t.groups.active, items: tasks.filter((item) => item.statut === "en_cours" || item.statut === "cadrage") },
    { id: "done", label: t.groups.done, items: tasks.filter((item) => DONE.includes(item.statut)) },
  ];

  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      {groups.map((group) =>
        group.items.length ? (
          <section key={group.id}>
            <h3 className="text-sm font-semibold">{group.label}</h3>
            <ul className="mt-2 flex flex-col gap-2">
              {group.items.map((item) => (
                <li key={item.id}>
                  <Surface elevation="pressed" radius="surface" className="flex flex-col gap-2 px-3 py-3">
                    <p className="font-semibold">{item.titre}</p>
                    <p className="text-xs text-content-muted">{t.statuses[item.statut]}</p>
                    <Button variant="secondary" tooltip={t.resume} pending={pending && openId === item.id} onClick={() => void resume(item.id)}>
                      {t.resume}
                    </Button>
                  </Surface>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
      {detail ? (
        <Surface elevation="soft" radius="card" className="p-3 text-sm" aria-live="polite">
          <p className="font-semibold">{t.resumeHint}</p>
          <p className="mt-1">{detail.objectif}</p>
          <ul className="mt-2 flex flex-col gap-1 text-content-muted">
            {(detail.journal ?? [])
              .filter((entry) => entry.type === "fait" || entry.type === "reste" || entry.type === "decision")
              .slice(-8)
              .map((entry) => (
                <li key={entry.id}>
                  {entry.type === "reste" ? t.journal.reste : entry.type === "decision" ? t.journal.decision : t.journal.fait}
                  {" — "}
                  {entry.contenu}
                </li>
              ))}
          </ul>
        </Surface>
      ) : null}
    </div>
  );
}
