"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { SoficauMark } from "@/components/brand/SoficauMark";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Surface } from "@/components/ui/Surface";
import { Tooltip } from "@/components/ui/Tooltip";
import { TextField } from "@/components/ui/TextField";
import { copy } from "@/content/fr";
import { interpolate } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { UserRole } from "@/lib/types";

type InviteInfo = {
  prenom: string;
  nom: string;
  email: string;
  role: UserRole;
  roleLabel: string;
};

export function InvitationPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const { signIn, signOut } = useSession();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "expired" | "used">(
    "loading",
  );
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void signOut();
    let cancelled = false;
    async function load() {
      const response = await fetch(`/api/invite/${token}`);
      const body = await response.json().catch(() => ({}));
      if (cancelled) return;
      if (!response.ok) {
        const status = body.status as "invalid" | "expired" | "used" | undefined;
        setState(status ?? "invalid");
        return;
      }
      setInfo(body as InviteInfo);
      setState("ready");
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token, signOut]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(undefined);
    setConfirmError(undefined);
    setFormError(undefined);

    if (password.length < 8) {
      setPasswordError(copy.invite.tooShort);
      return;
    }
    if (password !== confirmation) {
      setConfirmError(copy.invite.mismatch);
      return;
    }

    setPending(true);
    const response = await fetch(`/api/invite/${token}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, confirmation }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (body.field === "password") setPasswordError(body.error);
      else if (body.field === "confirmation") setConfirmError(body.error);
      else setFormError(body.error || copy.auth.errors.unavailable);
      setPending(false);
      return;
    }

    const login = await signIn(body.email, password);
    setPending(false);
    if (!login.ok) {
      router.replace("/connexion");
      return;
    }
    router.replace(login.role === "administrateur" ? "/admin" : "/chat");
  }

  if (state === "loading") {
    return (
      <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-3 py-8 sm:px-4 sm:py-12">
        <Surface elevation="soft" radius="card" className="px-5 py-10 text-content-muted" role="status">
          {copy.invite.loading}
        </Surface>
      </main>
    );
  }

  if (state !== "ready" || !info) {
    const title =
      state === "expired"
        ? copy.invite.expiredTitle
        : state === "used"
          ? copy.invite.usedTitle
          : copy.invite.invalidTitle;
    const body =
      state === "expired"
        ? copy.invite.expiredBody
        : state === "used"
          ? copy.invite.usedBody
          : copy.invite.invalidBody;
    return (
      <main className="mx-auto flex min-h-full max-w-lg flex-col justify-center px-3 py-10 sm:px-4 sm:py-16">
        <EmptyState
          title={title}
          body={body}
          action={
            <Tooltip
              label={state === "used" ? copy.invite.tipUsedAction : copy.invite.tipBackAction}
            >
              <Link
                href="/connexion"
                className="neo-bubble inline-flex min-h-11 items-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-inverse"
              >
                {state === "used" ? copy.invite.usedAction : copy.invite.backAction}
              </Link>
            </Tooltip>
          }
        />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-3 py-8 sm:px-4 sm:py-12">
      <Surface elevation="raised" radius="card" className="p-5 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <SoficauMark size={40} />
          <div className="min-w-0">
            <p className="text-sm text-content-muted">{copy.product.org}</p>
            <h1 className="text-xl font-semibold text-content sm:text-2xl">{copy.invite.title}</h1>
          </div>
        </div>
        <p className="mb-6 text-content-muted">
          {interpolate(copy.invite.lead, {
            name: `${info.prenom} ${info.nom}`.trim(),
            role: info.roleLabel,
          })}
        </p>
        <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
          <TextField
            id="invite-password"
            type="password"
            autoComplete="new-password"
            label={copy.invite.passwordLabel}
            hint={copy.invite.passwordHint}
            value={password}
            error={passwordError}
            onChange={(event) => setPassword(event.target.value)}
          />
          <TextField
            id="invite-password-confirm"
            type="password"
            autoComplete="new-password"
            label={copy.invite.confirmLabel}
            value={confirmation}
            error={confirmError}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {formError ? (
            <Alert title={formError} tone="danger" live="assertive" />
          ) : null}
          <Button type="submit" pending={pending} tooltip={copy.invite.tipSubmit}>
            {pending ? copy.invite.submitting : copy.invite.submit}
          </Button>
        </form>
      </Surface>
    </main>
  );
}
