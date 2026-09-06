"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectField } from "@/components/ui/SelectField";
import { Surface } from "@/components/ui/Surface";
import { TextField } from "@/components/ui/TextField";
import { copy } from "@/content/fr";
import { adminGet, adminPost } from "@/lib/admin-api";
import { formatDateTime, interpolate } from "@/lib/format";
import type { UserRole } from "@/lib/types";

type Person = {
  id: string;
  email: string;
  role: UserRole;
  prenom: string | null;
  nom: string | null;
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

function roleLabel(role: UserRole): string {
  return role === "administrateur" ? copy.admin.access.roleAdmin : copy.admin.access.roleUser;
}

function invitationStatus(item: Invitation): "pending" | "expired" | "accepted" {
  if (item.accepted_at) return "accepted";
  if (new Date(item.expires_at).getTime() <= Date.now()) return "expired";
  return "pending";
}

function fullName(prenom?: string | null, nom?: string | null): string {
  return [prenom, nom].filter(Boolean).join(" ") || "—";
}

export function AccessWorkspace() {
  const [people, setPeople] = useState<Person[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("utilisateur");
  const [errors, setErrors] = useState<Partial<Record<"prenom" | "nom" | "email" | "role" | "form", string>>>({});
  const [pending, setPending] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [pendingInvite, setPendingInvite] = useState(false);
  const [pendingResend, setPendingResend] = useState<Invitation | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    const result = await adminGet<{ people: Person[]; invitations: Invitation[] }>(
      "/api/invitations",
    );
    if (!result.ok) {
      setState("error");
      return;
    }
    setPeople(result.data.people);
    setInvitations(result.data.invitations);
    setState("ready");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
            <Button type="submit" pending={pending}>
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
            <Button variant="secondary" onClick={() => void load()}>
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
                      <Surface elevation="raised" radius="card" className="p-4">
                        <p className="font-semibold">{fullName(person.prenom, person.nom)}</p>
                        <p className="mt-1 break-all text-sm">{person.email}</p>
                        <p className="mt-1 text-sm text-content-muted">{roleLabel(person.role)}</p>
                      </Surface>
                    </li>
                  ))}
                </ul>
                <Surface elevation="raised" radius="card" className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[32rem] text-left text-sm">
                    <caption className="sr-only">{copy.admin.access.peopleLabel}</caption>
                    <thead>
                      <tr className="neo-pressed text-content-muted">
                        <th className="px-4 py-4 font-semibold">{copy.admin.access.columns.name}</th>
                        <th className="px-4 py-4 font-semibold">{copy.admin.access.columns.email}</th>
                        <th className="px-4 py-4 font-semibold">{copy.admin.access.columns.role}</th>
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
    </AdminFrame>
  );
}
