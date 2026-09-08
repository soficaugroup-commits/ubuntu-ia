"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectField } from "@/components/ui/SelectField";
import { Surface } from "@/components/ui/Surface";
import { TextField } from "@/components/ui/TextField";
import { copy } from "@/content/fr";
import { adminDelete, adminGet, adminPatch, adminPost } from "@/lib/admin-api";
import { formatDateTime, interpolate } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { AccountStatus, UserRole } from "@/lib/types";

type Person = {
  id: string;
  email: string;
  role: UserRole;
  prenom: string | null;
  nom: string | null;
  statut: AccountStatus;
};

type Invitation = {
  id: string;
  email: string;
  prenom: string;
  nom: string;
  role: UserRole;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

type Toast = { tone: "info" | "danger"; text: string };

type AccountAction = {
  kind: "suspend" | "reactivate" | "delete";
  person: Person;
};

function roleLabel(role: UserRole): string {
  return role === "administrateur" ? copy.admin.access.roleAdmin : copy.admin.access.roleUser;
}

function invitationStatus(item: Invitation): "pending" | "expired" | "accepted" {
  if (item.accepted_at) return "accepted";
  if (new Date(item.expires_at).getTime() <= Date.now()) return "expired";
  return "pending";
}

function fullName(prenom?: string | null, nom?: string | null): string {
  return [prenom, nom].filter(Boolean).join(" ") || copy.nav.unnamed;
}

function asStatus(value: unknown): AccountStatus {
  return value === "suspendu" ? "suspendu" : "actif";
}

export function AccessWorkspace() {
  const { user, refreshUser } = useSession();
  const [people, setPeople] = useState<Person[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("utilisateur");
  const [errors, setErrors] = useState<
    Partial<Record<"prenom" | "nom" | "email" | "role" | "form", string>>
  >({});
  const [pending, setPending] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [pendingInvite, setPendingInvite] = useState(false);
  const [pendingResend, setPendingResend] = useState<Invitation | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [editing, setEditing] = useState<Person | null>(null);
  const [editPrenom, setEditPrenom] = useState("");
  const [editNom, setEditNom] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("utilisateur");
  const [editErrors, setEditErrors] = useState<
    Partial<Record<"prenom" | "nom" | "role" | "form", string>>
  >({});
  const [editPending, setEditPending] = useState(false);
  const [accountAction, setAccountAction] = useState<AccountAction | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const activeAdminCount = useMemo(
    () => people.filter((person) => person.role === "administrateur" && person.statut === "actif").length,
    [people],
  );

  const load = useCallback(async () => {
    setState("loading");
    const result = await adminGet<{ people: Person[]; invitations: Invitation[] }>(
      "/api/invitations",
    );
    if (!result.ok) {
      setState("error");
      return;
    }
    setPeople(
      result.data.people.map((person) => ({
        ...person,
        statut: asStatus(person.statut),
      })),
    );
    setInvitations(result.data.invitations);
    setState("ready");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openEdit(person: Person) {
    setEditing(person);
    setEditPrenom(person.prenom ?? "");
    setEditNom(person.nom ?? "");
    setEditRole(person.role);
    setEditErrors({});
  }

  function requestInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (!prenom.trim()) nextErrors.prenom = copy.admin.access.errors.prenom;
    if (!nom.trim()) nextErrors.nom = copy.admin.access.errors.nom;
    if (!email.trim()) nextErrors.email = copy.admin.access.errors.email;
    if (!role) nextErrors.role = copy.admin.access.errors.role;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setPendingInvite(true);
  }

  async function confirmInvite() {
    setPending(true);
    const sentEmail = email.trim().toLowerCase();
    const result = await adminPost<{ ok: true }>("/api/invitations", {
      prenom: prenom.trim(),
      nom: nom.trim(),
      email: email.trim(),
      role,
    });
    setPending(false);
    setPendingInvite(false);
    if (!result.ok) {
      const field = result.field as keyof typeof errors | undefined;
      if (field && field !== "form") {
        setErrors({ [field]: result.error });
      } else {
        setErrors({ form: result.error });
      }
      return;
    }
    setPrenom("");
    setNom("");
    setEmail("");
    setRole("utilisateur");
    setErrors({});
    setToast({
      tone: "info",
      text: interpolate(copy.admin.access.sent, { email: sentEmail }),
    });
    await load();
  }

  async function confirmResend() {
    if (!pendingResend) return;
    setResendingId(pendingResend.id);
    const result = await adminPost<{ ok: true }>(
      `/api/invitations/${pendingResend.id}/resend`,
      {},
    );
    setResendingId(null);
    const target = pendingResend.email;
    setPendingResend(null);
    if (!result.ok) {
      setToast({ tone: "danger", text: result.error });
      return;
    }
    setToast({
      tone: "info",
      text: interpolate(copy.admin.access.resent, { email: target }),
    });
    await load();
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const nextErrors: typeof editErrors = {};
    if (!editPrenom.trim()) nextErrors.prenom = copy.admin.access.errors.prenom;
    if (!editNom.trim()) nextErrors.nom = copy.admin.access.errors.nom;
    if (!editRole) nextErrors.role = copy.admin.access.errors.role;
    setEditErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setEditPending(true);
    const result = await adminPatch<{ person: Person }>(`/api/users/${editing.id}`, {
      prenom: editPrenom.trim(),
      nom: editNom.trim(),
      role: editRole,
    });
    setEditPending(false);
    if (!result.ok) {
      setEditErrors({ form: result.error });
      return;
    }
    const name = fullName(editPrenom, editNom);
    setEditing(null);
    setToast({
      tone: "info",
      text: interpolate(copy.admin.access.editSaved, { name }),
    });
    await load();
    if (user?.id === result.data.person.id) {
      await refreshUser();
    }
  }

  async function confirmAccountAction() {
    if (!accountAction) return;
    const { kind, person } = accountAction;
    const name = fullName(person.prenom, person.nom);
    setActingId(person.id);

    if (kind === "delete") {
      const result = await adminDelete<{ ok: true }>(`/api/users/${person.id}`);
      setActingId(null);
      setAccountAction(null);
      if (!result.ok) {
        setToast({ tone: "danger", text: result.error });
        return;
      }
      setToast({
        tone: "info",
        text: interpolate(copy.admin.access.deletedToast, { name }),
      });
      await load();
      return;
    }

    const result = await adminPatch<{ person: Person }>(`/api/users/${person.id}`, {
      statut: kind === "suspend" ? "suspendu" : "actif",
    });
    setActingId(null);
    setAccountAction(null);
    if (!result.ok) {
      setToast({ tone: "danger", text: result.error });
      return;
    }
    setToast({
      tone: "info",
      text: interpolate(
        kind === "suspend" ? copy.admin.access.suspendedToast : copy.admin.access.reactivatedToast,
        { name },
      ),
    });
    await load();
  }

  function personGuards(person: Person) {
    const isSelf = user?.id === person.id;
    const lastAdmin =
      person.role === "administrateur" && person.statut === "actif" && activeAdminCount <= 1;
    return { isSelf, lastAdmin, locked: isSelf || lastAdmin };
  }

  function PersonActions({ person }: { person: Person }) {
    const { isSelf, lastAdmin, locked } = personGuards(person);
    const busy = actingId === person.id;
    const lockTip = isSelf ? copy.admin.access.tipSelfLocked : copy.admin.access.tipLastAdmin;

    return (
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          tooltip={copy.admin.access.tipEdit}
          onClick={() => openEdit(person)}
        >
          {copy.admin.access.edit}
        </Button>
        {person.statut === "suspendu" ? (
          <Button
            type="button"
            variant="secondary"
            pending={busy}
            tooltip={lastAdmin ? lockTip : copy.admin.access.tipReactivate}
            disabled={lastAdmin}
            onClick={() => setAccountAction({ kind: "reactivate", person })}
          >
            {copy.admin.access.reactivate}
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            pending={busy}
            tooltip={locked ? lockTip : copy.admin.access.tipSuspend}
            disabled={locked}
            onClick={() => setAccountAction({ kind: "suspend", person })}
          >
            {copy.admin.access.suspend}
          </Button>
        )}
        <Button
          type="button"
          variant="danger"
          pending={busy}
          tooltip={locked ? lockTip : copy.admin.access.tipDelete}
          disabled={locked}
          onClick={() => setAccountAction({ kind: "delete", person })}
        >
          {copy.admin.access.delete}
        </Button>
      </div>
    );
  }

  function StatusPill({ statut }: { statut: AccountStatus }) {
    return (
      <span
        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
          statut === "suspendu" ? "bg-accent text-brand neo-gold" : "bg-brand text-inverse neo-bubble"
        }`}
      >
        {copy.admin.access.accountStatus[statut]}
      </span>
    );
  }

  const confirmCopy =
    accountAction?.kind === "delete"
      ? {
          title: copy.admin.access.deleteTitle,
          body: interpolate(copy.admin.access.deleteBody, {
            name: fullName(accountAction.person.prenom, accountAction.person.nom),
          }),
          confirm: copy.admin.access.deleteConfirm,
          pending: copy.admin.access.deleting,
          danger: true,
        }
      : accountAction?.kind === "suspend"
        ? {
            title: copy.admin.access.suspendTitle,
            body: interpolate(copy.admin.access.suspendBody, {
              name: fullName(accountAction.person.prenom, accountAction.person.nom),
            }),
            confirm: copy.admin.access.suspendConfirm,
            pending: copy.admin.access.suspending,
            danger: true,
          }
        : accountAction
          ? {
              title: copy.admin.access.reactivateTitle,
              body: interpolate(copy.admin.access.reactivateBody, {
                name: fullName(accountAction.person.prenom, accountAction.person.nom),
              }),
              confirm: copy.admin.access.reactivateConfirm,
              pending: copy.admin.access.reactivating,
              danger: false,
            }
          : null;

  const editingLastAdmin =
    editing?.role === "administrateur" &&
    editing.statut === "actif" &&
    activeAdminCount <= 1;

  return (
    <AdminFrame>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{copy.admin.access.pageTitle}</h1>
        <p className="text-content-muted">{copy.admin.access.pageLead}</p>
      </header>

      <Surface as="section" elevation="raised" radius="card" className="p-5">
        <h2 className="text-lg font-semibold">{copy.admin.access.inviteTitle}</h2>
        <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={requestInvite}>
          <TextField
            id="prenom"
            label={copy.admin.access.prenomLabel}
            value={prenom}
            error={errors.prenom}
            onChange={(event) => setPrenom(event.target.value)}
          />
          <TextField
            id="nom"
            label={copy.admin.access.nomLabel}
            value={nom}
            error={errors.nom}
            onChange={(event) => setNom(event.target.value)}
          />
          <TextField
            id="invite-email"
            type="email"
            label={copy.admin.access.emailLabel}
            hint={copy.admin.access.emailHint}
            placeholder={copy.auth.emailPlaceholder}
            value={email}
            error={errors.email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <SelectField
            id="invite-role"
            label={copy.admin.access.roleLabel}
            value={role}
            error={errors.role}
            onChange={(value) => setRole(value as UserRole)}
          >
            <option value="utilisateur">{copy.admin.access.roleUser}</option>
            <option value="administrateur">{copy.admin.access.roleAdmin}</option>
          </SelectField>
          {errors.form ? (
            <div className="md:col-span-2">
              <Alert tone="danger" title={errors.form} live="assertive" />
            </div>
          ) : null}
          <div className="md:col-span-2">
            <Button type="submit" pending={pending} tooltip={copy.admin.access.tipSend}>
              {pending ? copy.admin.access.sending : copy.admin.access.send}
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
          {copy.admin.access.loading}
        </Surface>
      ) : null}

      {state === "error" ? (
        <Alert
          tone="danger"
          title={copy.admin.access.loadErrorTitle}
          body={copy.admin.access.loadErrorBody}
          action={
            <Button
              variant="secondary"
              tooltip={copy.admin.access.tipRetryLoad}
              onClick={() => void load()}
            >
              {copy.admin.access.retryLoad}
            </Button>
          }
        />
      ) : null}

      {state === "ready" ? (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{copy.admin.access.peopleTitle}</h2>
            {people.length === 0 ? (
              <EmptyState
                title={copy.admin.access.peopleEmptyTitle}
                body={copy.admin.access.peopleEmptyBody}
              />
            ) : (
              <>
                <ul className="flex flex-col gap-3 lg:hidden" aria-label={copy.admin.access.peopleLabel}>
                  {people.map((person) => (
                    <li key={person.id}>
                      <Surface elevation="raised" radius="card" className="flex flex-col gap-3 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="font-semibold">{fullName(person.prenom, person.nom)}</p>
                          <StatusPill statut={person.statut} />
                        </div>
                        <p className="break-all text-sm">{person.email}</p>
                        <p className="text-sm text-content-muted">{roleLabel(person.role)}</p>
                        <PersonActions person={person} />
                      </Surface>
                    </li>
                  ))}
                </ul>
                <Surface elevation="raised" radius="card" className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[48rem] text-left text-sm">
                    <caption className="sr-only">{copy.admin.access.peopleLabel}</caption>
                    <thead>
                      <tr className="neo-pressed text-content-muted">
                        <th className="px-4 py-4 font-semibold">{copy.admin.access.columns.name}</th>
                        <th className="px-4 py-4 font-semibold">{copy.admin.access.columns.email}</th>
                        <th className="px-4 py-4 font-semibold">{copy.admin.access.columns.role}</th>
                        <th className="px-4 py-4 font-semibold">{copy.admin.access.columns.status}</th>
                        <th className="px-4 py-4 font-semibold">{copy.admin.access.columns.actions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {people.map((person) => (
                        <tr key={person.id}>
                          <td className="px-4 py-4 font-semibold">
                            {fullName(person.prenom, person.nom)}
                          </td>
                          <td className="px-4 py-4">{person.email}</td>
                          <td className="px-4 py-4">{roleLabel(person.role)}</td>
                          <td className="px-4 py-4">
                            <StatusPill statut={person.statut} />
                          </td>
                          <td className="px-4 py-4">
                            <PersonActions person={person} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Surface>
              </>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{copy.admin.access.invitationsTitle}</h2>
            {invitations.length === 0 ? (
              <EmptyState
                title={copy.admin.access.invitationsEmptyTitle}
                body={copy.admin.access.invitationsEmptyBody}
              />
            ) : (
              <>
                <ul className="flex flex-col gap-3 lg:hidden" aria-label={copy.admin.access.invitationsLabel}>
                  {invitations.map((item) => {
                    const status = invitationStatus(item);
                    return (
                      <li key={item.id}>
                        <Surface elevation="raised" radius="card" className="flex flex-col gap-3 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <p className="font-semibold">{fullName(item.prenom, item.nom)}</p>
                            <span
                              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                                status === "accepted"
                                  ? "bg-brand text-inverse neo-bubble"
                                  : status === "expired"
                                    ? "bg-accent text-brand neo-gold"
                                    : "neo-soft text-content"
                              }`}
                            >
                              {copy.admin.access.status[status]}
                            </span>
                          </div>
                          <p className="break-all text-sm">{item.email}</p>
                          <p className="text-sm text-content-muted">
                            {roleLabel(item.role)} · {formatDateTime(item.created_at)}
                          </p>
                          {status !== "accepted" ? (
                            <Button
                              variant="secondary"
                              pending={resendingId === item.id}
                              tooltip={copy.admin.access.tipResend}
                              onClick={() => setPendingResend(item)}
                            >
                              {resendingId === item.id
                                ? copy.admin.access.resending
                                : copy.admin.access.resend}
                            </Button>
                          ) : null}
                        </Surface>
                      </li>
                    );
                  })}
                </ul>
                <Surface elevation="raised" radius="card" className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[40rem] text-left text-sm">
                    <caption className="sr-only">{copy.admin.access.invitationsLabel}</caption>
                    <thead>
                      <tr className="neo-pressed text-content-muted">
                        <th className="px-4 py-4 font-semibold">{copy.admin.access.columns.name}</th>
                        <th className="px-4 py-4 font-semibold">{copy.admin.access.columns.email}</th>
                        <th className="px-4 py-4 font-semibold">{copy.admin.access.columns.role}</th>
                        <th className="px-4 py-4 font-semibold">{copy.admin.access.columns.status}</th>
                        <th className="px-4 py-4 font-semibold">{copy.admin.access.columns.date}</th>
                        <th className="px-4 py-4 font-semibold">{copy.admin.access.columns.actions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invitations.map((item) => {
                        const status = invitationStatus(item);
                        return (
                          <tr key={item.id}>
                            <td className="px-4 py-4 font-semibold">
                              {fullName(item.prenom, item.nom)}
                            </td>
                            <td className="px-4 py-4">{item.email}</td>
                            <td className="px-4 py-4">{roleLabel(item.role)}</td>
                            <td className="px-4 py-4">
                              <span
                                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                                  status === "accepted"
                                    ? "bg-brand text-inverse neo-bubble"
                                    : status === "expired"
                                      ? "bg-accent text-brand neo-gold"
                                      : "neo-soft text-content"
                                }`}
                              >
                                {copy.admin.access.status[status]}
                              </span>
                            </td>
                            <td className="px-4 py-4">{formatDateTime(item.created_at)}</td>
                            <td className="px-4 py-4">
                              {status !== "accepted" ? (
                                <Button
                                  variant="secondary"
                                  pending={resendingId === item.id}
                                  tooltip={copy.admin.access.tipResend}
                                  onClick={() => setPendingResend(item)}
                                >
                                  {resendingId === item.id
                                    ? copy.admin.access.resending
                                    : copy.admin.access.resend}
                                </Button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Surface>
              </>
            )}
          </section>
        </>
      ) : null}

      <Dialog
        open={Boolean(editing)}
        title={copy.admin.access.editTitle}
        onClose={() => {
          if (!editPending) setEditing(null);
        }}
      >
        <form className="flex flex-col gap-4" onSubmit={(event) => void saveEdit(event)}>
          <TextField
            id="edit-prenom"
            label={copy.admin.access.prenomLabel}
            value={editPrenom}
            error={editErrors.prenom}
            onChange={(event) => setEditPrenom(event.target.value)}
          />
          <TextField
            id="edit-nom"
            label={copy.admin.access.nomLabel}
            value={editNom}
            error={editErrors.nom}
            onChange={(event) => setEditNom(event.target.value)}
          />
          <SelectField
            id="edit-role"
            label={copy.admin.access.roleLabel}
            value={editRole}
            error={editErrors.role}
            disabled={editingLastAdmin}
            hint={editingLastAdmin ? copy.admin.access.tipLastAdmin : undefined}
            onChange={(value) => setEditRole(value as UserRole)}
          >
            <option value="utilisateur">{copy.admin.access.roleUser}</option>
            <option value="administrateur">{copy.admin.access.roleAdmin}</option>
          </SelectField>
          {editErrors.form ? (
            <Alert tone="danger" title={editErrors.form} live="assertive" />
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              tooltip={copy.tips.cancel}
              disabled={editPending}
              onClick={() => setEditing(null)}
            >
              {copy.admin.confirm.cancel}
            </Button>
            <Button
              type="submit"
              pending={editPending}
              tooltip={copy.admin.access.tipEdit}
            >
              {editPending ? copy.admin.access.editSaving : copy.admin.access.editSave}
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={pendingInvite}
        title={copy.admin.access.inviteConfirmTitle}
        body={interpolate(copy.admin.access.inviteConfirmBody, {
          name: fullName(prenom, nom),
          email: email.trim(),
          role: roleLabel(role),
        })}
        confirmLabel={copy.admin.access.inviteConfirm}
        pending={pending}
        pendingLabel={copy.admin.access.sending}
        onConfirm={() => void confirmInvite()}
        onClose={() => {
          if (!pending) setPendingInvite(false);
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingResend)}
        title={copy.admin.access.resendConfirmTitle}
        body={interpolate(copy.admin.access.resendConfirmBody, {
          email: pendingResend?.email ?? "",
        })}
        confirmLabel={copy.admin.access.resendConfirm}
        pending={Boolean(resendingId)}
        pendingLabel={copy.admin.access.resending}
        onConfirm={() => void confirmResend()}
        onClose={() => {
          if (!resendingId) setPendingResend(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(accountAction && confirmCopy)}
        title={confirmCopy?.title ?? ""}
        body={confirmCopy?.body ?? ""}
        confirmLabel={confirmCopy?.confirm ?? copy.admin.access.deleteConfirm}
        pending={Boolean(actingId)}
        pendingLabel={confirmCopy?.pending}
        danger={confirmCopy?.danger}
        onConfirm={() => void confirmAccountAction()}
        onClose={() => {
          if (!actingId) setAccountAction(null);
        }}
      />
    </AdminFrame>
  );
}
