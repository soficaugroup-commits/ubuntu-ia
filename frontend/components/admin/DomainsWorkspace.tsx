"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Surface } from "@/components/ui/Surface";
import { TextField } from "@/components/ui/TextField";
import { copy } from "@/content/fr";
import {
  addAllowedDomain,
  listAllowedDomains,
  removeAllowedDomain,
} from "@/lib/allowed-domains";
import type { AllowedDomain } from "@/lib/domains";
import { isValidDomain, normalizeDomain } from "@/lib/domains";
import { formatDateTime, interpolate } from "@/lib/format";
import { useSession } from "@/lib/session";

type Toast = { tone: "info" | "danger"; text: string };

export function DomainsWorkspace() {
  const { user } = useSession();
  const [domains, setDomains] = useState<AllowedDomain[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [draft, setDraft] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AllowedDomain | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    const rows = await listAllowedDomains();
    if (!rows) {
      setState("error");
      return;
    }
    setDomains(rows);
    setState("ready");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function requestAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const domaine = normalizeDomain(draft);
    setFieldError(undefined);
    if (!domaine) {
      setFieldError(copy.admin.domains.errors.required);
      return;
    }
    if (!isValidDomain(domaine)) {
      setFieldError(copy.admin.domains.errors.invalid);
      return;
    }
    if (domains.some((item) => item.domaine === domaine)) {
      setFieldError(copy.admin.domains.errors.duplicate);
      return;
    }
    setPendingAdd(domaine);
  }

  async function confirmAdd() {
    if (!pendingAdd) return;
    setPending(true);
    const result = await addAllowedDomain(pendingAdd);
    setPending(false);
    if (!result.ok) {
      setFieldError(copy.admin.domains.errors[result.code]);
      setPendingAdd(null);
      return;
    }
    setDraft("");
    setDomains((current) =>
      [...current, result.domain].sort((a, b) => a.domaine.localeCompare(b.domaine)),
    );
    setToast({
      tone: "info",
      text: interpolate(copy.admin.domains.added, { domain: pendingAdd }),
    });
    setPendingAdd(null);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    if (domains.length <= 1) {
      setToast({ tone: "danger", text: copy.admin.domains.errors.last });
      setPendingDelete(null);
      return;
    }
    setDeleting(true);
    const result = await removeAllowedDomain(pendingDelete.id);
    setDeleting(false);
    if (!result.ok) {
      setToast({ tone: "danger", text: copy.admin.domains.errors[result.code] });
      setPendingDelete(null);
      return;
    }
    const removed = pendingDelete.domaine;
    setDomains((current) => current.filter((item) => item.id !== pendingDelete.id));
    setPendingDelete(null);
    setToast({
      tone: "info",
      text: interpolate(copy.admin.domains.removed, { domain: removed }),
    });
  }

  const ownDomain = user?.email.split("@")[1]?.toLowerCase();
  const lastRemaining = domains.length <= 1;

  return (
    <AdminFrame>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{copy.admin.domains.pageTitle}</h1>
        <p className="text-content-muted">{copy.admin.domains.pageLead}</p>
      </header>

      <Surface as="section" elevation="raised" radius="card" className="p-5">
        <h2 className="text-lg font-semibold">{copy.admin.domains.addTitle}</h2>
        <form className="mt-4 flex flex-col gap-4" onSubmit={requestAdd}>
          <TextField
            id="domaine"
            label={copy.admin.domains.fieldLabel}
            hint={copy.admin.domains.fieldHint}
            placeholder={copy.admin.domains.fieldPlaceholder}
            value={draft}
            error={fieldError}
            onChange={(event) => {
              setDraft(event.target.value);
              if (fieldError) setFieldError(undefined);
            }}
          />
          <div>
            <Button type="submit" pending={pending} tooltip={copy.admin.domains.tipAdd}>
              {pending ? copy.admin.domains.adding : copy.admin.domains.add}
            </Button>
          </div>
        </form>
      </Surface>

      {toast ? (
        <Surface
          elevation={toast.tone === "danger" ? "gold" : "soft"}
          radius="card"
          className={`px-4 py-3 ${
            toast.tone === "danger"
              ? "bg-accent-subtle font-medium text-accent-hover"
              : "text-content"
          }`}
          role="status"
          aria-live="polite"
        >
          {toast.text}
        </Surface>
      ) : null}

      {state === "loading" ? (
        <Surface elevation="soft" radius="card" className="px-5 py-10 text-content-muted" role="status">
          {copy.admin.domains.loading}
        </Surface>
      ) : null}

      {state === "error" ? (
        <Alert
          tone="danger"
          title={copy.admin.domains.loadErrorTitle}
          body={copy.admin.domains.loadErrorBody}
          action={
            <Button
              variant="secondary"
              tooltip={copy.admin.domains.tipRetryLoad}
              onClick={() => void load()}
            >
              {copy.admin.domains.retryLoad}
            </Button>
          }
        />
      ) : null}

      {state === "ready" && domains.length === 0 ? (
        <EmptyState
          title={copy.admin.domains.emptyTitle}
          body={copy.admin.domains.emptyBody}
        />
      ) : null}

      {state === "ready" && domains.length > 0 ? (
        <>
          <ul className="flex flex-col gap-3 lg:hidden" aria-label={copy.admin.domains.tableLabel}>
            {domains.map((item) => (
              <li key={item.id}>
                <Surface elevation="raised" radius="card" className="flex flex-col gap-3 p-4">
                  <p className="font-semibold">@{item.domaine}</p>
                  <p className="text-sm text-content-muted">{formatDateTime(item.date_ajout)}</p>
                  <Button
                    variant="danger"
                    disabled={lastRemaining}
                    tooltip={
                      lastRemaining ? copy.admin.domains.lastHint : copy.admin.domains.tipDelete
                    }
                    onClick={() => setPendingDelete(item)}
                  >
                    {copy.admin.domains.delete}
                  </Button>
                </Surface>
              </li>
            ))}
          </ul>
          <Surface elevation="raised" radius="card" className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <caption className="sr-only">{copy.admin.domains.tableLabel}</caption>
              <thead>
                <tr className="neo-pressed text-content-muted">
                  <th className="px-4 py-4 font-semibold">{copy.admin.domains.columns.domain}</th>
                  <th className="px-4 py-4 font-semibold">{copy.admin.domains.columns.date}</th>
                  <th className="px-4 py-4 font-semibold">{copy.admin.domains.columns.actions}</th>
                </tr>
              </thead>
              <tbody>
                {domains.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-4 font-semibold">@{item.domaine}</td>
                    <td className="px-4 py-4">{formatDateTime(item.date_ajout)}</td>
                    <td className="px-4 py-4">
                      <Button
                        variant="danger"
                        disabled={lastRemaining}
                        tooltip={
                          lastRemaining ? copy.admin.domains.lastHint : copy.admin.domains.tipDelete
                        }
                        onClick={() => setPendingDelete(item)}
                      >
                        {copy.admin.domains.delete}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Surface>
        </>
      ) : null}

      {lastRemaining && state === "ready" ? (
        <p className="text-sm text-content-muted">{copy.admin.domains.lastHint}</p>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingAdd)}
        title={copy.admin.domains.addConfirmTitle}
        body={interpolate(copy.admin.domains.addConfirmBody, {
          domain: pendingAdd ?? "",
        })}
        confirmLabel={copy.admin.domains.addConfirm}
        pending={pending}
        pendingLabel={copy.admin.domains.adding}
        onConfirm={() => void confirmAdd()}
        onClose={() => {
          if (!pending) setPendingAdd(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={
          pendingDelete
            ? interpolate(copy.admin.domains.deleteTitle, {
                domain: pendingDelete.domaine,
              })
            : ""
        }
        body={
          pendingDelete
            ? interpolate(
                pendingDelete.domaine === ownDomain
                  ? copy.admin.domains.deleteBodyOwn
                  : copy.admin.domains.deleteBody,
                { domain: pendingDelete.domaine },
              )
            : ""
        }
        confirmLabel={copy.admin.domains.deleteConfirm}
        cancelLabel={copy.admin.domains.deleteCancel}
        pending={deleting}
        pendingLabel={copy.admin.domains.deleting}
        danger
        onConfirm={() => void confirmDelete()}
        onClose={() => {
          if (!deleting) setPendingDelete(null);
        }}
      />
    </AdminFrame>
  );
}
