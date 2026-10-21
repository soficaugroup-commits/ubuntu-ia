"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectField } from "@/components/ui/SelectField";
import { Surface } from "@/components/ui/Surface";
import { TextField } from "@/components/ui/TextField";
import { copy } from "@/content/fr";
import { formatDateTime, interpolate } from "@/lib/format";
import { loadAdminTemplates, removeTemplate, updateTemplate, uploadTemplate } from "@/lib/templates-api";
import type { DocumentTemplate, KnowledgeCategory } from "@/lib/types";

type Toast = { tone: "info" | "danger"; text: string };

const ACCEPT =
  ".docx,.pptx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_BYTES = 25 * 1024 * 1024;
const FORMAT_LABEL: Record<DocumentTemplate["format"], string> = { docx: "Word", pptx: "PowerPoint", xlsx: "Excel" };

const t = copy.admin.templates;

function fieldSummary(template: DocumentTemplate): string[] {
  const lines = template.champs.map((field) => {
    const columns = (field.colonnes ?? []).join(", ");
    if (field.type === "boucle") return interpolate(t.loopFields, { name: field.nom, columns });
    if (field.type === "tableau") return interpolate(t.tableFields, { name: field.nom, columns });
    return field.nom;
  });
  if (lines.length) return lines;
  const structure = template.structure;
  if (structure.titres?.length) return [t.noFields, interpolate(t.headings, { count: String(structure.titres.length) })];
  if (structure.diapositives) return [t.noFields, interpolate(t.slides, { count: String(structure.diapositives) })];
  if (structure.feuilles?.length) return [interpolate(t.sheets, { names: structure.feuilles.join(", ") })];
  return [t.noFields];
}

export function TemplatesWorkspace() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [file, setFile] = useState<File | null>(null);
  const [nom, setNom] = useState("");
  const [description, setDescription] = useState("");
  const [categorie, setCategorie] = useState("");
  const [fileError, setFileError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DocumentTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  function apply(result: Awaited<ReturnType<typeof loadAdminTemplates>>) {
    if (!result.ok) {
      setState("error");
      return;
    }
    setTemplates(result.modeles);
    setCategories(result.categories);
    setState("ready");
  }

  useEffect(() => {
    let alive = true;
    void loadAdminTemplates().then((result) => {
      if (alive) apply(result);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function reload() {
    setState("loading");
    apply(await loadAdminTemplates());
  }

  function chooseFile(next: File) {
    if (!/\.(docx|pptx|xlsx)$/i.test(next.name)) {
      setFileError(t.errors.file);
      return;
    }
    if (next.size > MAX_BYTES) {
      setFileError(t.errors.size);
      return;
    }
    setFileError(undefined);
    setFile(next);
    if (!nom.trim()) setNom(next.name.replace(/\.[^.]+$/, ""));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setFileError(t.errors.file);
      return;
    }
    setUploading(true);
    const result = await uploadTemplate({ file, nom, description, categorie });
    setUploading(false);
    if (!result.ok) {
      setToast({ tone: "danger", text: result.error });
      return;
    }
    setTemplates((current) => [result.modele, ...current]);
    setFile(null);
    setNom("");
    setDescription("");
    setCategorie("");
    setToast({ tone: "info", text: interpolate(t.uploaded, { name: result.modele.nom }) });
  }

  async function toggle(template: DocumentTemplate) {
    setBusyId(template.id);
    const result = await updateTemplate(template.id, { actif: !template.actif });
    setBusyId(null);
    if (!result.ok) {
      setToast({ tone: "danger", text: result.error });
      return;
    }
    setTemplates((current) =>
      current.map((item) => (item.id === template.id ? { ...result.modele, apercuUrl: item.apercuUrl } : item)),
    );
    setToast({ tone: "info", text: interpolate(t.updated, { name: result.modele.nom }) });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const result = await removeTemplate(pendingDelete.id);
    setDeleting(false);
    const removed = pendingDelete;
    setPendingDelete(null);
    if (!result.ok) {
      setToast({ tone: "danger", text: result.error });
      return;
    }
    setTemplates((current) => current.filter((item) => item.id !== removed.id));
    setToast({ tone: "info", text: interpolate(t.removed, { name: removed.nom }) });
  }

  function actions(template: DocumentTemplate) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          pending={busyId === template.id}
          tooltip={template.actif ? t.tipDeactivate : t.tipActivate}
          onClick={() => void toggle(template)}
        >
          {template.actif ? t.deactivate : t.activate}
        </Button>
        <Button variant="danger" tooltip={t.tipDelete} onClick={() => setPendingDelete(template)}>
          {t.delete}
        </Button>
      </div>
    );
  }

  function statusChip(template: DocumentTemplate) {
    return (
      <span
        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
          template.actif ? "bg-brand text-inverse neo-bubble" : "neo-pressed text-content-muted"
        }`}
      >
        {template.actif ? t.active : t.inactive}
      </span>
    );
  }

  return (
    <AdminFrame>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t.pageTitle}</h1>
        <p className="text-content-muted">{t.pageLead}</p>
      </header>

      <Surface as="section" elevation="raised" radius="card" className="p-5">
        <h2 className="text-lg font-semibold">{t.uploadTitle}</h2>
        <form className="mt-4 flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-content" id="modele-fichier-label">
              {t.fileLabel}
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                tooltip={t.tipFileChoose}
                aria-describedby="modele-fichier-label modele-fichier-hint"
                onClick={() => fileRef.current?.click()}
              >
                {file ? t.fileChange : t.fileChoose}
              </Button>
              <span className="min-w-0 truncate text-sm text-content-muted">{file?.name ?? t.fileNone}</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const next = event.target.files?.[0];
                if (next) chooseFile(next);
                event.target.value = "";
              }}
            />
            <p id="modele-fichier-hint" className="text-sm text-content-muted">
              {t.fileHint}
            </p>
            {fileError ? (
              <p className="text-sm font-medium text-accent-hover" role="alert">
                {fileError}
              </p>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              id="modele-nom"
              label={t.nameLabel}
              hint={t.nameHint}
              value={nom}
              maxLength={160}
              onChange={(event) => setNom(event.target.value)}
            />
            <SelectField
              id="modele-categorie"
              label={t.categoryLabel}
              value={categorie}
              className="w-full"
              onChange={setCategorie}
            >
              <option value="">{t.categoryNone}</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </SelectField>
          </div>
          <TextField
            id="modele-description"
            label={t.descriptionLabel}
            hint={t.descriptionHint}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <Surface elevation="soft" radius="surface" className="px-4 py-3 text-sm text-content-muted">
            {t.tagsHelp}
          </Surface>
          <div>
            <Button type="submit" pending={uploading} tooltip={t.tipUpload}>
              {uploading ? t.uploading : t.upload}
            </Button>
          </div>
        </form>
      </Surface>

      {toast ? (
        <Surface
          elevation={toast.tone === "danger" ? "gold" : "soft"}
          radius="card"
          className={`px-4 py-3 ${toast.tone === "danger" ? "bg-accent-subtle font-medium text-accent-hover" : "text-content"}`}
          role="status"
          aria-live="polite"
        >
          {toast.text}
        </Surface>
      ) : null}

      {state === "loading" ? (
        <Surface elevation="soft" radius="card" className="px-5 py-10 text-content-muted" role="status">
          {t.loading}
        </Surface>
      ) : null}

      {state === "error" ? (
        <Alert
          tone="danger"
          title={t.loadErrorTitle}
          body={t.loadErrorBody}
          action={
            <Button variant="secondary" tooltip={t.tipRetryLoad} onClick={() => void reload()}>
              {t.retryLoad}
            </Button>
          }
        />
      ) : null}

      {state === "ready" && templates.length === 0 ? <EmptyState title={t.emptyTitle} body={t.emptyBody} /> : null}

      {state === "ready" && templates.length > 0 ? (
        <ul className="grid gap-4 lg:grid-cols-2" aria-label={t.tableLabel}>
          {templates.map((template) => (
            <li key={template.id}>
              <Surface elevation="raised" radius="card" className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{template.nom}</p>
                    <p className="text-sm text-content-muted">
                      {FORMAT_LABEL[template.format]} · {formatDateTime(template.updated_at)}
                    </p>
                  </div>
                  {statusChip(template)}
                </div>
                {template.description ? <p className="text-sm">{template.description}</p> : null}
                {template.apercuUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={template.apercuUrl}
                    alt={interpolate(t.previewAlt, { name: template.nom })}
                    className="w-full rounded-surface neo-pressed"
                  />
                ) : null}
                <div>
                  <p className="text-xs font-semibold text-content-muted">{t.columns.fields}</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {fieldSummary(template).map((line) => (
                      <li key={line} className="rounded-full px-3 py-1 text-xs neo-pressed">
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-auto">{actions(template)}</div>
              </Surface>
            </li>
          ))}
        </ul>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete ? interpolate(t.deleteTitle, { name: pendingDelete.nom }) : ""}
        body={t.deleteBody}
        confirmLabel={t.deleteConfirm}
        pending={deleting}
        pendingLabel={t.deleting}
        danger
        onConfirm={() => void confirmDelete()}
        onClose={() => {
          if (!deleting) setPendingDelete(null);
        }}
      />
    </AdminFrame>
  );
}
