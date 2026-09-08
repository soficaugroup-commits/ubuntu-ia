"use client";

import { useEffect, useState } from "react";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectField } from "@/components/ui/SelectField";
import { Surface } from "@/components/ui/Surface";
import { copy } from "@/content/fr";
import { loadAdminFeedback } from "@/lib/feedback-api";
import { formatDateTime } from "@/lib/format";
import type { AdminFeedback, FeedbackType } from "@/lib/types";

type Filter = FeedbackType | "tous";

export function FeedbackWorkspace() {
  const [filter, setFilter] = useState<Filter>("negatif");
  const [items, setItems] = useState<AdminFeedback[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  async function reload(next: Filter = filter) {
    setState("loading");
    setError(null);
    const result = await loadAdminFeedback(next);
    if (!result.ok) {
      setError(result.error);
      setState("error");
      return;
    }
    setItems(result.feedbacks);
    setState("ready");
  }

  useEffect(() => {
    void reload("negatif");
    // premier chargement : retours négatifs, critère de revue
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AdminFrame>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{copy.admin.feedback.pageTitle}</h1>
          <p className="text-content-muted">{copy.admin.feedback.pageLead}</p>
        </div>
        <SelectField
          id="filtre-retours"
          className="w-full max-w-xs"
          label={copy.admin.feedback.filterLabel}
          value={filter}
          onChange={(value) => {
            const next = value as Filter;
            setFilter(next);
            void reload(next);
          }}
        >
          <option value="negatif">{copy.admin.feedback.filterNegative}</option>
          <option value="positif">{copy.admin.feedback.filterPositive}</option>
          <option value="tous">{copy.admin.feedback.filterAll}</option>
        </SelectField>
      </header>

      {state === "loading" ? (
        <Surface elevation="soft" radius="card" className="px-5 py-10 text-content-muted" role="status">
          {copy.admin.feedback.loading}
        </Surface>
      ) : null}

      {state === "error" ? (
        <Alert
          tone="danger"
          title={copy.admin.feedback.loadErrorTitle}
          body={error ?? copy.admin.feedback.loadErrorBody}
          action={
            <Button variant="secondary" tooltip={copy.admin.feedback.tipRetryLoad} onClick={() => void reload()}>
              {copy.admin.feedback.retryLoad}
            </Button>
          }
        />
      ) : null}

      {state === "ready" && items.length === 0 ? (
        <EmptyState
          title={copy.admin.feedback.emptyTitle}
          body={copy.admin.feedback.emptyBody}
        />
      ) : null}

      {state === "ready" && items.length > 0 ? (
        <ul className="flex flex-col gap-3" aria-label={copy.admin.feedback.pageTitle}>
          {items.map((item) => (
            <li key={item.id}>
              <Surface elevation="raised" radius="card" className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {item.userName || copy.admin.feedback.anonymous}
                    </p>
                    <p className="text-sm text-content-muted">{item.userEmail}</p>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                      item.type === "negatif"
                        ? "bg-accent text-brand neo-gold"
                        : "bg-brand text-inverse neo-bubble"
                    }`}
                  >
                    {item.type === "negatif"
                      ? copy.admin.feedback.typeNegative
                      : copy.admin.feedback.typePositive}
                  </span>
                </div>
                <p className="text-sm text-content-muted">{formatDateTime(item.dateCreation)}</p>
                {item.extraitQuestion ? (
                  <div>
                    <p className="text-xs font-semibold text-content-muted">
                      {copy.admin.feedback.questionLabel}
                    </p>
                    <p className="mt-1 text-sm">{item.extraitQuestion}</p>
                  </div>
                ) : null}
                {item.extraitReponse ? (
                  <Surface elevation="pressed" radius="surface" className="p-3">
                    <p className="text-xs font-semibold text-content-muted">
                      {copy.admin.feedback.answerLabel}
                    </p>
                    <p className="mt-1 text-sm">{item.extraitReponse}</p>
                  </Surface>
                ) : null}
                {item.commentaire ? (
                  <div>
                    <p className="text-xs font-semibold text-content-muted">
                      {copy.admin.feedback.commentLabel}
                    </p>
                    <p className="mt-1 text-sm">{item.commentaire}</p>
                  </div>
                ) : null}
              </Surface>
            </li>
          ))}
        </ul>
      ) : null}
    </AdminFrame>
  );
}
