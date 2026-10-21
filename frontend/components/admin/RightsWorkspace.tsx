"use client";

import { useEffect, useState } from "react";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { Alert } from "@/components/ui/Alert";
import { SelectField } from "@/components/ui/SelectField";
import { Surface } from "@/components/ui/Surface";
import { copy } from "@/content/fr";
import { supabaseBrowser } from "@/lib/supabase";
import type { UserRole } from "@/lib/types";

type PermissionLevel = "autorise" | "validation_requise" | "interdit";

const t = copy.admin.rights;
const LEVELS: PermissionLevel[] = ["autorise", "validation_requise", "interdit"];

type Row = { role: UserRole; action: string; niveau: PermissionLevel };

export function RightsWorkspace() {
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    void load().then((result) => {
      if (!alive) return;
      if (!result) {
        setState("error");
        return;
      }
      setRows(result);
      setState("ready");
    });
    return () => {
      alive = false;
    };
  }, []);

  async function change(row: Row, niveau: PermissionLevel) {
    setRows((current) =>
      current.map((item) => (item.role === row.role && item.action === row.action ? { ...item, niveau } : item)),
    );
    const response = await fetch("/api/admin/droits", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(await auth()) },
      body: JSON.stringify({ role: row.role, action: row.action, niveau }),
    });
    setNotice(response.ok ? t.saved : t.loadError);
  }

  return (
    <AdminFrame>
      <header>
        <h1 className="text-2xl font-semibold">{t.pageTitle}</h1>
        <p className="text-content-muted">{t.pageLead}</p>
      </header>
      {notice ? (
        <Surface elevation="soft" radius="card" className="px-4 py-3 text-sm" role="status">
          {notice}
        </Surface>
      ) : null}
      {state === "loading" ? <p className="text-content-muted">{t.loading}</p> : null}
      {state === "error" ? <Alert tone="danger" title={t.loadError} /> : null}
      {state === "ready" ? (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={`${row.role}-${row.action}`}>
              <Surface elevation="raised" radius="card" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
                <p className="min-w-0 flex-1 text-sm">
                  <span className="font-semibold">{row.role}</span>
                  <span className="text-content-muted"> · {row.action}</span>
                </p>
                <SelectField
                  id={`droit-${row.role}-${row.action}`}
                  label={row.action}
                  value={row.niveau}
                  onChange={(value) => void change(row, value as PermissionLevel)}
                >
                  {LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {t.levels[level]}
                    </option>
                  ))}
                </SelectField>
              </Surface>
            </li>
          ))}
        </ul>
      ) : null}
    </AdminFrame>
  );
}

async function load(): Promise<Row[] | null> {
  const response = await fetch("/api/admin/droits", { cache: "no-store", headers: await auth() });
  if (!response.ok) return null;
  const body = (await response.json()) as { droits?: Row[] };
  return body.droits ?? [];
}

async function auth(): Promise<Record<string, string>> {
  const supabase = supabaseBrowser();
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
