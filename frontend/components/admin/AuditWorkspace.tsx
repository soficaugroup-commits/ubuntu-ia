"use client";

import { useEffect, useState } from "react";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Surface } from "@/components/ui/Surface";
import { copy } from "@/content/fr";
import { formatDateTime } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase";

const t = copy.admin.audit;

type Entry = {
  id: string;
  horodatage: string;
  acteur: string;
  action: string;
  cible: string;
};

export function AuditWorkspace() {
  const [rows, setRows] = useState<Entry[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const supabase = supabaseBrowser();
      const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
      const response = await fetch("/api/admin/audit", {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!alive) return;
      if (!response.ok) {
        setState("error");
        return;
      }
      const body = (await response.json()) as { journal?: Entry[] };
      setRows(body.journal ?? []);
      setState("ready");
    })();
    return () => {
      alive = false;
    };
  }, []);

  function exportCsv() {
    const header = [t.columns.when, t.columns.who, t.columns.action, t.columns.target];
    const lines = rows.map((row) => [row.horodatage, row.acteur, row.action, row.cible].map(csv).join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "journal-audit.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <AdminFrame>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.pageTitle}</h1>
          <p className="text-content-muted">{t.pageLead}</p>
        </div>
        <Button variant="secondary" tooltip={t.export} disabled={!rows.length} onClick={exportCsv}>
          {t.export}
        </Button>
      </header>
      {state === "loading" ? <p className="text-content-muted">{t.loading}</p> : null}
      {state === "error" ? <Alert tone="danger" title={t.loadError} /> : null}
      {state === "ready" && rows.length === 0 ? <EmptyState title={t.empty} body={t.pageLead} /> : null}
      {state === "ready" && rows.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Surface elevation="pressed" radius="surface" className="px-4 py-3 text-sm">
                <p className="font-semibold">{row.action}</p>
                <p className="text-content-muted">
                  {formatDateTime(row.horodatage)} · {row.acteur}
                  {row.cible ? ` · ${row.cible}` : ""}
                </p>
              </Surface>
            </li>
          ))}
        </ul>
      ) : null}
    </AdminFrame>
  );
}

function csv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
