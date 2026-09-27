"use client";

import { useEffect, useState } from "react";
import { RequireSession } from "@/components/auth/RequireSession";
import { Button, Surface, TextField } from "@/components/ui";
import { useSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase";

type SettingsPayload = {
  organisation: string;
  quota: number;
  used: number;
  role: string;
};

async function authHeaders(): Promise<HeadersInit> {
  const supabase = supabaseBrowser();
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function SettingsBody() {
  const { user } = useSession();
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [quota, setQuota] = useState("200");
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const headers = await authHeaders();
        const response = await fetch("/api/reglages", { headers });
        const body = (await response.json()) as SettingsPayload & { error?: string };
        if (!response.ok) throw new Error(body.error || "Réglages indisponibles.");
        setData(body);
        setQuota(String(body.quota));
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : "Réglages indisponibles.");
      }
    })();
  }, [user]);

  async function saveQuota() {
    setSaved(false);
    setError(undefined);
    const headers = await authHeaders();
    const response = await fetch("/api/reglages", {
      method: "PATCH",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ quota: Number(quota) }),
    });
    const body = (await response.json()) as { error?: string; quota?: number };
    if (!response.ok) {
      setError(body.error || "Le quota n'a pas pu être enregistré.");
      return;
    }
    setSaved(true);
    setData((current) => (current ? { ...current, quota: body.quota ?? current.quota } : current));
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <Surface elevation="raised" radius="card" className="p-6">
        <h1 className="text-xl font-semibold text-content">Réglages</h1>
        <p className="mt-2 text-sm text-content">
          Organisation : {data?.organisation ?? "…"}. Messages aujourd&apos;hui : {data?.used ?? 0} /{" "}
          {data?.quota ?? "…"}.
        </p>
        <p className="mt-3 text-sm text-content">
          La recherche documentaire, le web et l&apos;analyse approfondie se règlent dans le menu du
          compositeur, et restent mémorisés d&apos;un envoi à l&apos;autre.
        </p>
        {error ? <p className="mt-3 text-sm text-content">{error}</p> : null}
      </Surface>
      {user?.role === "administrateur" ? (
        <Surface elevation="raised" radius="card" className="flex flex-col gap-4 p-6">
          <TextField
            id="quota"
            label="Quota de messages par personne et par jour"
            value={quota}
            onChange={(event) => setQuota(event.target.value)}
          />
          <Button type="button" onClick={() => void saveQuota()}>
            Enregistrer le forfait
          </Button>
          {saved ? <p className="text-sm text-content">Forfait enregistré.</p> : null}
        </Surface>
      ) : null}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <RequireSession>
      <SettingsBody />
    </RequireSession>
  );
}
