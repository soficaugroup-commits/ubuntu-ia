"use client";

import { useEffect, useState } from "react";
import { RequireSession } from "@/components/auth/RequireSession";
import { Button, Surface, TextField } from "@/components/ui";
import { copy } from "@/content/fr";
import { interpolate } from "@/lib/format";
import { useSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase";

type OutlookState = { active: boolean; configured: boolean; compte: string | null };

type SettingsPayload = {
  organisation: string;
  quota: number;
  used: number;
  role: string;
  outlook?: OutlookState;
};

type PendingAction = { id: string; apercu: string; statut: string };

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
  const [actions, setActions] = useState<PendingAction[]>([]);
  const outlook = data?.outlook;

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
        const pending = await fetch("/api/actions", { headers });
        if (pending.ok) {
          const listed = (await pending.json()) as { actions?: PendingAction[] };
          setActions((listed.actions ?? []).filter((item) => item.statut === "proposee" || item.statut === "approuvee"));
        }
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : "Réglages indisponibles.");
      }
    })();
  }, [user]);

  async function toggleOutlook(enabled: boolean) {
    setError(undefined);
    const response = await fetch("/api/reglages", {
      method: "PATCH",
      headers: { ...(await authHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({ outlook: enabled }),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(body.error || copy.reglages.outlookMissing);
      return;
    }
    setData((current) => (current?.outlook ? { ...current, outlook: { ...current.outlook, active: enabled } } : current));
  }

  async function connectOutlook() {
    setError(undefined);
    const response = await fetch("/api/connecteurs/microsoft/connexion", { headers: await authHeaders() });
    const body = (await response.json()) as { url?: string; error?: string };
    if (!response.ok || !body.url) {
      setError(body.error || copy.reglages.outlookMissing);
      return;
    }
    window.location.href = body.url;
  }

  async function disconnectOutlook() {
    setError(undefined);
    const response = await fetch("/api/connecteurs/microsoft/revoquer", {
      method: "POST",
      headers: await authHeaders(),
    });
    if (!response.ok) {
      setError(copy.reglages.outlookMissing);
      return;
    }
    setData((current) => (current?.outlook ? { ...current, outlook: { ...current.outlook, compte: null } } : current));
  }

  async function approve(id: string) {
    const headers = await authHeaders();
    const accepted = await fetch(`/api/actions/${id}/approuver`, { method: "POST", headers });
    if (!accepted.ok) return;
    await fetch(`/api/actions/${id}/executer`, { method: "POST", headers });
    setActions((current) => current.filter((item) => item.id !== id));
  }

  async function refuse(id: string) {
    const response = await fetch(`/api/actions/${id}/refuser`, { method: "POST", headers: await authHeaders() });
    if (response.ok) setActions((current) => current.filter((item) => item.id !== id));
  }

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
      <Surface elevation="raised" radius="card" className="flex flex-col gap-3 p-6">
        <h2 className="text-lg font-semibold text-content">{copy.reglages.outlookTitle}</h2>
        <p className="text-sm text-content">
          {!outlook?.active
            ? copy.reglages.outlookOff
            : !outlook.configured
              ? copy.reglages.outlookMissing
              : outlook.compte
                ? interpolate(copy.reglages.outlookConnected, { compte: outlook.compte })
                : copy.reglages.outlookReady}
        </p>
        <div className="flex flex-wrap gap-2">
          {user?.role === "administrateur" ? (
            <Button
              type="button"
              variant="secondary"
              tooltip={outlook?.active ? copy.reglages.outlookDisable : copy.reglages.outlookEnable}
              onClick={() => void toggleOutlook(!outlook?.active)}
            >
              {outlook?.active ? copy.reglages.outlookDisable : copy.reglages.outlookEnable}
            </Button>
          ) : null}
          {outlook?.active && outlook.configured && !outlook.compte ? (
            <Button type="button" tooltip={copy.reglages.outlookConnect} onClick={() => void connectOutlook()}>
              {copy.reglages.outlookConnect}
            </Button>
          ) : null}
          {outlook?.compte ? (
            <Button type="button" variant="danger" tooltip={copy.reglages.outlookDisconnect} onClick={() => void disconnectOutlook()}>
              {copy.reglages.outlookDisconnect}
            </Button>
          ) : null}
        </div>
      </Surface>
      <Surface elevation="raised" radius="card" className="flex flex-col gap-3 p-6">
        <h2 className="text-lg font-semibold text-content">{copy.reglages.actionsTitle}</h2>
        {actions.length === 0 ? <p className="text-sm text-content">{copy.reglages.actionsEmpty}</p> : null}
        <ul className="flex flex-col gap-3">
          {actions.map((item) => (
            <li key={item.id} className="flex flex-col gap-2">
              <p className="text-sm text-content">{item.apercu}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" tooltip={copy.reglages.approveRun} onClick={() => void approve(item.id)}>
                  {copy.reglages.approveRun}
                </Button>
                <Button type="button" variant="danger" tooltip={copy.reglages.refuse} onClick={() => void refuse(item.id)}>
                  {copy.reglages.refuse}
                </Button>
              </div>
            </li>
          ))}
        </ul>
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
