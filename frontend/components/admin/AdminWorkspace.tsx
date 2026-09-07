"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectField } from "@/components/ui/SelectField";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Surface } from "@/components/ui/Surface";
import { TextField } from "@/components/ui/TextField";
import { copy } from "@/content/fr";
import { ALL_CATEGORIES, categoryLabel, validateNewCategory } from "@/lib/categories";
import {
  parseDocumentUrl,
  useDocuments,
  validateUploadFile,
} from "@/lib/documents-store";
import { INDEXABLE_ACCEPT } from "@/lib/upload-files";
import { formatDateTime, interpolate } from "@/lib/format";
import type { DocumentCategory, KnowledgeDocument } from "@/lib/types";

type Toast = { tone: "info" | "danger"; text: string };

type PendingAction =
  | { kind: "file"; file: File }
  | { kind: "url"; href: string }
  | { kind: "category"; label: string }
  | { kind: "retry"; document: KnowledgeDocument }
  | { kind: "retryAll" }
  | { kind: "delete"; document: KnowledgeDocument };

export function AdminWorkspace() {
  const {
    documents,
    categories,
    hasEverHadDocuments,
    addFile,
    addUrl,
    addCategory,
    retryIndex,
    retryAll,
    remove,
    loadState,
    loadError,
    reload,
  } = useDocuments();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<DocumentCategory>("institutionnel");
  const [filter, setFilter] = useState<string>(ALL_CATEGORIES);
  const [newCategory, setNewCategory] = useState("");
  const [categoryError, setCategoryError] = useState<string | undefined>();
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | undefined>();
  const [fileError, setFileError] = useState<string | undefined>();
  const [urlPending, setUrlPending] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [dragging, setDragging] = useState(false);
  const previousStatuses = useRef<Record<string, KnowledgeDocument["statut_indexation"]>>(
    {},
  );

  useEffect(() => {
    for (const document of documents) {
      const previous = previousStatuses.current[document.id];
      if (previous === "en_cours" && document.statut_indexation === "termine") {
        setToast({
          tone: "info",
          text: interpolate(copy.admin.indexed, { title: document.titre }),
        });
      }
      if (previous === "en_cours" && document.statut_indexation === "erreur") {
        setToast({
          tone: "danger",
          text: interpolate(copy.admin.indexFailed, { title: document.titre }),
        });
      }
      previousStatuses.current[document.id] = document.statut_indexation;
    }
  }, [documents]);

  const visibleDocuments = useMemo(
    () =>
      filter === ALL_CATEGORIES
        ? documents
        : documents.filter((document) => document.categorie === filter),
    [documents, filter],
  );

  const view = useMemo(() => {
    if (documents.length === 0) {
      return hasEverHadDocuments ? ("cleared" as const) : ("first" as const);
    }
    if (visibleDocuments.length === 0) return "emptyFilter" as const;
    return "ready" as const;
  }, [documents.length, hasEverHadDocuments, visibleDocuments.length]);

  function labelOf(id: string) {
    return categoryLabel(id, categories);
  }

  function announce(next: Toast) {
    setToast(next);
  }

  function requestFile(file: File) {
    setFileError(undefined);
    const check = validateUploadFile(file);
    if (!check.ok) {
      setFileError(copy.admin.errors[check.code]);
      return;
    }
    setPendingAction({ kind: "file", file });
  }

  function onAddCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCategoryError(undefined);
    const result = validateNewCategory(newCategory, categories);
    if (!result.ok) {
      setCategoryError(copy.admin.errors.category[result.code]);
      return;
    }
    setPendingAction({ kind: "category", label: result.category.label });
  }

  function onUrlSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUrlError(undefined);
    const parsed = parseDocumentUrl(url);
    if (!parsed.ok) {
      setUrlError(copy.admin.errors[parsed.code]);
      return;
    }
    setPendingAction({ kind: "url", href: parsed.href });
  }

  function closeConfirm() {
    if (confirming) return;
    setPendingAction(null);
  }

  async function confirmPending() {
    if (!pendingAction) return;
    setConfirming(true);

    if (pendingAction.kind === "file") {
      const result = await addFile(pendingAction.file, category);
      setConfirming(false);
      setPendingAction(null);
      if (!result.ok) {
        setFileError(result.message ?? copy.admin.errors[result.code]);
        return;
      }
      if (filter !== ALL_CATEGORIES) setFilter(category);
      announce({
        tone: "info",
        text: interpolate(copy.admin.queued, { title: result.document.titre }),
      });
      return;
    }

    if (pendingAction.kind === "url") {
      setUrlPending(true);
      const result = await addUrl(pendingAction.href, category);
      setUrlPending(false);
      setConfirming(false);
      setPendingAction(null);
      if (!result.ok) {
        setUrlError(result.message ?? copy.admin.errors[result.code]);
        return;
      }
      setUrl("");
      if (filter !== ALL_CATEGORIES) setFilter(category);
      announce({
        tone: "info",
        text: interpolate(copy.admin.queued, { title: result.document.titre }),
      });
      return;
    }

    if (pendingAction.kind === "category") {
      const result = await addCategory(pendingAction.label);
      setConfirming(false);
      setPendingAction(null);
      if (!result.ok) {
        setCategoryError(result.message ?? copy.admin.errors.category[result.code]);
        return;
      }
      setNewCategory("");
      setCategory(result.category.id);
      setFilter(result.category.id);
      announce({
        tone: "info",
        text: interpolate(copy.admin.categoryAdded, { label: result.category.label }),
      });
      return;
    }

    if (pendingAction.kind === "retry") {
      const result = await retryIndex(pendingAction.document.id);
      setConfirming(false);
      setPendingAction(null);
      if (!result.ok) {
        announce({ tone: "danger", text: result.message });
        return;
      }
      announce({
        tone: "info",
        text: interpolate(copy.admin.queued, { title: pendingAction.document.titre }),
      });
      return;
    }

    if (pendingAction.kind === "retryAll") {
      const result = await retryAll();
      setConfirming(false);
      setPendingAction(null);
      if (!result.ok) {
        announce({ tone: "danger", text: result.message });
        return;
      }
      announce({
        tone: "info",
        text: interpolate(copy.admin.retryAllQueued, { count: String(result.count) }),
      });
      return;
    }

    const removed = await remove(pendingAction.document.id);
    setConfirming(false);
    setPendingAction(null);
    if (!removed.ok) {
      announce({ tone: "danger", text: removed.message });
      return;
    }
    announce({
      tone: "info",
      text: interpolate(copy.admin.deleted, { title: removed.document.titre }),
    });
  }

  const confirmCopy = pendingAction
    ? pendingAction.kind === "file"
      ? {
          title: copy.admin.indexFileTitle,
          body: interpolate(copy.admin.indexFileBody, {
            title: pendingAction.file.name,
            category: labelOf(category),
          }),
          confirmLabel: copy.admin.indexFileConfirm,
          danger: false,
          pendingLabel: copy.admin.urlSubmitting,
        }
      : pendingAction.kind === "url"
        ? {
            title: copy.admin.indexUrlTitle,
            body: interpolate(copy.admin.indexUrlBody, {
              url: pendingAction.href,
              category: labelOf(category),
            }),
            confirmLabel: copy.admin.indexUrlConfirm,
            danger: false,
            pendingLabel: copy.admin.urlSubmitting,
          }
        : pendingAction.kind === "category"
          ? {
              title: copy.admin.addCategoryConfirmTitle,
              body: interpolate(copy.admin.addCategoryConfirmBody, {
                label: pendingAction.label,
              }),
              confirmLabel: copy.admin.addCategoryConfirm,
              danger: false,
              pendingLabel: copy.admin.categorySaving,
            }
          : pendingAction.kind === "retry"
            ? {
                title: copy.admin.retryTitle,
                body: interpolate(copy.admin.retryBody, {
                  title: pendingAction.document.titre,
                }),
                confirmLabel: copy.admin.retryConfirm,
                danger: false,
              }
            : pendingAction.kind === "retryAll"
              ? {
                  title: copy.admin.retryAllTitle,
                  body: copy.admin.retryAllBody,
                  confirmLabel: copy.admin.retryAllConfirm,
                  danger: false,
                }
            : {
                title: interpolate(copy.admin.deleteTitle, {
                  title: pendingAction.document.titre,
                }),
                body: copy.admin.deleteBody,
                confirmLabel: copy.admin.deleteConfirm,
                danger: true,
                pendingLabel: copy.admin.deleting,
              }
    : null;

  return (
    <AdminFrame>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{copy.admin.pageTitle}</h1>
          <p className="text-content-muted">{copy.admin.pageLead}</p>
        </div>
        {documents.length > 0 ? (
          <Button variant="secondary" onClick={() => setPendingAction({ kind: "retryAll" })}>
            {copy.admin.retryAll}
          </Button>
        ) : null}
      </header>

      {toast ? (
        <Surface
          elevation={toast.tone === "danger" ? "gold" : "soft"}
          radius="card"
          className={`px-4 py-3 ${
            toast.tone === "danger" ? "bg-accent-subtle font-medium text-accent-hover" : "text-content"
          }`}
          role="status"
          aria-live="polite"
        >
          {toast.text}
        </Surface>
      ) : null}

      {loadState === "loading" ? (
        <Surface elevation="soft" radius="card" className="px-5 py-10 text-content-muted" role="status">
          {copy.admin.loading}
        </Surface>
      ) : null}

      {loadState === "error" ? (
        <Alert
          tone="danger"
          title={copy.admin.loadErrorTitle}
          body={loadError ?? copy.admin.loadErrorBody}
          action={
            <Button variant="secondary" onClick={() => void reload()}>
              {copy.admin.retryLoad}
            </Button>
          }
        />
      ) : null}

      {loadState === "ready" && view === "first" ? (
        <EmptyState
          title={copy.admin.emptyFirstTitle}
          body={copy.admin.emptyFirstBody}
          action={
            <Button onClick={() => fileInputRef.current?.click()}>
              {copy.admin.emptyAction}
            </Button>
          }
        />
      ) : null}

      {loadState === "ready" && view === "cleared" ? (
        <EmptyState
          title={copy.admin.emptyClearedTitle}
          body={copy.admin.emptyClearedBody}
          action={
            <Button onClick={() => fileInputRef.current?.click()}>
              {copy.admin.emptyAction}
            </Button>
          }
        />
      ) : null}

      {loadState === "ready" && view === "emptyFilter" ? (
        <EmptyState
          title={interpolate(copy.admin.emptyFilterTitle, { label: labelOf(filter) })}
          body={copy.admin.emptyFilterBody}
          action={
            <Button variant="secondary" onClick={() => setFilter(ALL_CATEGORIES)}>
              {copy.admin.emptyFilterAction}
            </Button>
          }
        />
      ) : null}

      {loadState === "ready" && view === "ready" ? (
        <ul className="flex flex-col gap-3" aria-label={copy.admin.tableLabel}>
            {visibleDocuments.map((document) => (
              <li key={document.id}>
                <Surface elevation="raised" radius="card" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-semibold">{document.titre}</p>
                      <StatusBadge status={document.statut_indexation} />
                    </div>
                    {document.statut_indexation === "erreur" && document.message_erreur ? (
                      <p className="text-sm text-content-muted">{document.message_erreur}</p>
                    ) : null}
                    <p className="text-sm text-content-muted">
                      {labelOf(document.categorie)} ·{" "}
                      {document.type_source === "url"
                        ? copy.admin.sourceUrl
                        : copy.admin.sourceFile}
                    </p>
                    {document.url_source ? (
                      <a
                        href={document.url_source}
                        className="neo-link break-all text-sm"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {document.url_source}
                      </a>
                    ) : null}
                    <p className="text-sm text-content-muted">
                      {formatDateTime(document.date_ajout)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:shrink-0 sm:flex-col sm:items-stretch">
                    {document.statut_indexation === "erreur" ? (
                      <Button
                        variant="secondary"
                        onClick={() => setPendingAction({ kind: "retry", document })}
                      >
                        {copy.admin.retryIndex}
                      </Button>
                    ) : null}
                    <Button
                      variant="danger"
                      onClick={() => setPendingAction({ kind: "delete", document })}
                    >
                      {copy.admin.delete}
                    </Button>
                  </div>
                </Surface>
              </li>
            ))}
          </ul>
      ) : null}

      <Surface as="section" elevation="raised" radius="card" className="flex flex-col gap-5 p-5">
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{copy.admin.categoriesTitle}</h2>
        </header>
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            id="categorie"
            className="w-full max-w-sm"
            label={copy.admin.categoryIndexLabel}
            hint={copy.admin.categoryIndexHint}
            value={category}
            onChange={(next) => setCategory(next)}
          >
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="filtre-categorie"
            className="w-full max-w-sm"
            label={copy.admin.categoryFilterLabel}
            hint={copy.admin.categoryFilterHint}
            value={filter}
            onChange={setFilter}
          >
            <option value={ALL_CATEGORIES}>{copy.admin.categoryFilterAll}</option>
            {categories.map((item) => {
              const count = documents.filter((doc) => doc.categorie === item.id).length;
              return (
                <option key={item.id} value={item.id}>
                  {count ? `${item.label} (${count})` : item.label}
                </option>
              );
            })}
          </SelectField>
        </div>
        <form className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end" onSubmit={onAddCategory}>
          <TextField
            id="nouvelle-categorie"
            label={copy.admin.categoryAddLabel}
            hint={copy.admin.categoryAddHint}
            placeholder={copy.admin.categoryAddPlaceholder}
            value={newCategory}
            error={categoryError}
            onChange={(event) => {
              setNewCategory(event.target.value);
              if (categoryError) setCategoryError(undefined);
            }}
          />
          <Button type="submit">{copy.admin.categoryAdd}</Button>
        </form>
      </Surface>

      <div className="grid gap-4 lg:grid-cols-2">
        <Surface as="section" elevation="raised" radius="card" className="p-5">
          <h2 className="text-lg font-semibold">{copy.admin.uploadTitle}</h2>
          <p className="mt-1 text-sm text-content-muted">{copy.admin.uploadLead}</p>
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) requestFile(file);
            }}
            className={`mt-4 rounded-surface px-4 py-8 text-center ${
              dragging ? "neo-pressed" : "neo-soft"
            }`}
          >
            <p>
              {copy.admin.uploadDrop}{" "}
              <button
                type="button"
                className="neo-link"
                onClick={() => fileInputRef.current?.click()}
              >
                {copy.admin.uploadBrowse}
              </button>
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={INDEXABLE_ACCEPT}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) requestFile(file);
                event.target.value = "";
              }}
            />
          </div>
          {fileError ? (
            <p className="mt-2 text-sm font-medium text-accent-hover" role="alert">
              {fileError}
            </p>
          ) : null}
        </Surface>

        <Surface as="section" elevation="raised" radius="card" className="p-5">
          <h2 className="text-lg font-semibold">{copy.admin.urlTitle}</h2>
          <form className="mt-4 flex flex-col gap-4" onSubmit={onUrlSubmit}>
            <TextField
              id="url"
              type="url"
              label={copy.admin.urlLabel}
              hint={copy.admin.urlHint}
              placeholder={copy.admin.urlPlaceholder}
              value={url}
              error={urlError}
              onChange={(event) => setUrl(event.target.value)}
            />
            <Button type="submit" pending={urlPending}>
              {urlPending ? copy.admin.urlSubmitting : copy.admin.urlSubmit}
            </Button>
          </form>
        </Surface>
      </div>

      <ConfirmDialog
        open={Boolean(pendingAction && confirmCopy)}
        title={confirmCopy?.title ?? ""}
        body={confirmCopy?.body ?? ""}
        confirmLabel={confirmCopy?.confirmLabel ?? copy.admin.confirm.cancel}
        pending={confirming}
        pendingLabel={confirmCopy?.pendingLabel}
        danger={confirmCopy?.danger}
        onConfirm={confirmPending}
        onClose={closeConfirm}
      />
    </AdminFrame>
  );
}
