"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { SoficauMark } from "@/components/brand/SoficauMark";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { TextField } from "@/components/ui/TextField";
import { copy } from "@/content/fr";
import { formatAllowedDomains } from "@/lib/domains";
import { interpolate } from "@/lib/format";
import { recordFailedAttempt, useSession } from "@/lib/session";

export function LoginForm() {
  const router = useRouter();
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailError(undefined);
    setPasswordError(undefined);
    setFormError(undefined);
    setPending(true);

    const result = await signIn(email, password);
    if (!result.ok) {
      const failure =
        result.code === "credentials" ? recordFailedAttempt() : result;
      const message =
        failure.code === "emailDomain"
          ? failure.domains?.length
            ? interpolate(copy.auth.errors.emailDomain, {
                domains: formatAllowedDomains(failure.domains),
              })
            : copy.auth.errors.emailDomainEmpty
          : copy.auth.errors[failure.code];
      if (failure.field === "email") setEmailError(message);
      else if (failure.field === "password") setPasswordError(message);
      else setFormError(message);
      setPending(false);
      return;
    }

    router.replace(result.role === "administrateur" ? "/admin" : "/chat");
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-3 py-8 sm:px-4 sm:py-12">
      <Surface elevation="raised" radius="card" className="p-5 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <SoficauMark size={40} />
          <div className="min-w-0">
            <p className="text-sm text-content-muted">{copy.product.org}</p>
            <h1 className="text-xl font-semibold text-content sm:text-2xl">{copy.auth.title}</h1>
          </div>
        </div>
        <p className="mb-6 text-content-muted">{copy.auth.lead}</p>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <TextField
            id="email"
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
          <TextField
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            label={copy.auth.passwordLabel}
            value={password}
            error={passwordError}
            onChange={(event) => setPassword(event.target.value)}
          />
          {formError ? (
            <Alert title={formError} body="" tone="danger" live="assertive" />
          ) : null}
          <Button type="submit" pending={pending} tooltip={copy.auth.tipSubmit}>
            {pending ? copy.auth.submitting : copy.auth.submit}
          </Button>
        </form>
        <p className="mt-6 text-sm text-content-muted">{copy.auth.demoNotice}</p>
      </Surface>
    </main>
  );
}
