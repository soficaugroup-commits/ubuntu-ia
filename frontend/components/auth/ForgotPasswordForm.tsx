"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { SoficauMark } from "@/components/brand/SoficauMark";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { TextField } from "@/components/ui/TextField";
import { copy } from "@/content/fr";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [success, setSuccess] = useState<string | undefined>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailError(undefined);
    setFormError(undefined);
    setSuccess(undefined);
    setPending(true);

    const response = await fetch("/api/password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      field?: string;
      message?: string;
    };
    setPending(false);

    if (!response.ok) {
      if (body.field === "email") setEmailError(body.error);
      else setFormError(body.error || copy.passwordReset.requestError);
      return;
    }

    setSuccess(body.message || copy.passwordReset.requestSuccess);
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-3 py-8 sm:px-4 sm:py-12">
      <Surface elevation="raised" radius="card" className="p-5 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <SoficauMark size={40} />
          <div className="min-w-0">
            <p className="text-sm text-content-muted">{copy.product.org}</p>
            <h1 className="text-xl font-semibold text-content sm:text-2xl">
              {copy.passwordReset.requestTitle}
            </h1>
          </div>
        </div>
        <p className="mb-6 text-content-muted">{copy.passwordReset.requestLead}</p>
        {success ? (
          <div className="flex flex-col gap-4">
            <Alert title={success} tone="info" live="polite" />
            <Link
              href="/connexion"
              className="neo-bubble inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-inverse"
            >
              {copy.passwordReset.backToLogin}
            </Link>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)} noValidate>
            <TextField
              id="reset-email"
              name="email"
              type="email"
              autoComplete="username"
              label={copy.auth.emailLabel}
              hint={copy.auth.emailHint}
              placeholder={copy.auth.emailPlaceholder}
              value={email}
              error={emailError}
              onChange={(event) => setEmail(event.target.value)}
            />
            {formError ? (
              <Alert title={formError} tone="danger" live="assertive" />
            ) : null}
            <Button type="submit" pending={pending} tooltip={copy.passwordReset.tipRequest}>
              {pending ? copy.passwordReset.requestSubmitting : copy.passwordReset.requestSubmit}
            </Button>
            <p className="text-center text-sm text-content-muted">
              <Link href="/connexion" className="font-semibold text-content underline-offset-2 hover:underline">
                {copy.passwordReset.backToLogin}
              </Link>
            </p>
          </form>
        )}
      </Surface>
    </main>
  );
}
