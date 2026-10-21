"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { TextField } from "@/components/ui/TextField";
import { copy } from "@/content/fr";
import { interpolate } from "@/lib/format";
import {
  acceptTaskPlan,
  advanceAgentTask,
  approveTaskStep,
  cancelAgentTask,
  loadTask,
  replyToTask,
} from "@/lib/tasks-api";
import type { AgentTask } from "@/lib/types";

const t = copy.chat.tasks;

export function TaskCard({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<AgentTask | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState("");

  useEffect(() => {
    let alive = true;
    void loadTask(taskId).then((result) => {
      if (!alive) return;
      if (!result.ok) {
        setState("error");
        setError(result.error);
        return;
      }
      setTask(result.tache);
      setState("ready");
    });
    return () => {
      alive = false;
    };
  }, [taskId]);

  async function run(action: () => Promise<{ ok: true; tache: AgentTask } | { ok: false; error: string }>) {
    setPending(true);
    const result = await action();
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(undefined);
    setTask(result.tache);
  }

  async function launch() {
    setPending(true);
    const accepted = await acceptTaskPlan(taskId);
    if (!accepted.ok) {
      setPending(false);
      setError(accepted.error);
      return;
    }
    const advanced = await advanceAgentTask(taskId);
    const fresh = await loadTask(taskId);
    setPending(false);
    if (!advanced.ok) setError(advanced.error);
    if (fresh.ok) setTask(fresh.tache);
  }

  if (state === "loading") {
    return (
      <Surface elevation="soft" radius="card" className="mt-3 px-4 py-3 text-sm text-content-muted" role="status">
        {t.loading}
      </Surface>
    );
  }
  if (state === "error" || !task) {
    return <Alert tone="danger" title={t.loadError} body={error} />;
  }

  const done = task.plan.filter((step) => step.statut === "faite" || step.statut === "sautee").length;
  const waitingStep = task.plan.find((step) => step.statut === "bloquee" && step.necessiteValidation);
  const journal = task.journal ?? [];
  const resume = journal.filter((entry) => entry.type === "fait" || entry.type === "decision").slice(-3);

  return (
    <Surface elevation="raised" radius="card" className="mt-3 flex flex-col gap-3 p-4" aria-live="polite">
      <div>
        <p className="text-xs font-semibold text-content-muted">{t.statuses[task.statut]}</p>
        <p className="font-semibold">{task.titre}</p>
        <p className="text-sm text-content-muted">{task.objectif}</p>
      </div>
      <p className="text-sm">{interpolate(t.progress, { done: String(done), total: String(task.plan.length) })}</p>
      <ol className="flex flex-col gap-1 text-sm">
        {task.plan.map((step) => (
          <li key={step.id}>
            {step.ordre}. {step.description}{" "}
            <span className="text-content-muted">({t.stepStatuses[step.statut]})</span>
          </li>
        ))}
      </ol>
      {resume.length ? (
        <div>
          <p className="text-sm font-semibold">{t.resumeHint}</p>
          <ul className="mt-1 text-sm text-content-muted">
            {resume.map((entry) => (
              <li key={entry.id}>
                {t.journal[entry.type === "decision" ? "decision" : "fait"]} — {entry.contenu}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? (
        <p className="text-sm font-medium text-accent-hover" role="alert">
          {error}
        </p>
      ) : null}
      {task.statut === "plan_propose" ? (
        <Button tooltip={t.validatePlan} pending={pending} onClick={() => void launch()}>
          {pending ? t.validating : t.validatePlan}
        </Button>
      ) : null}
      {task.statut === "en_attente_utilisateur" ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => replyToTask(taskId, answer));
          }}
        >
          <TextField id={`reponse-${taskId}`} label={t.askLabel} value={answer} onChange={(event) => setAnswer(event.target.value)} />
          <Button type="submit" pending={pending} tooltip={t.askSubmit}>
            {t.askSubmit}
          </Button>
        </form>
      ) : null}
      {task.statut === "en_attente_validation" && waitingStep ? (
        <Button tooltip={t.approveStep} pending={pending} onClick={() => void run(() => approveTaskStep(taskId, waitingStep.ordre))}>
          {t.approveStep}
        </Button>
      ) : null}
      {task.statut !== "terminee" && task.statut !== "annulee" ? (
        <Button variant="danger" tooltip={t.cancel} pending={pending} onClick={() => void run(() => cancelAgentTask(taskId))}>
          {t.cancel}
        </Button>
      ) : null}
    </Surface>
  );
}
