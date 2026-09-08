"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Surface } from "@/components/ui/Surface";
import { copy } from "@/content/fr";
import { deleteMemory } from "@/lib/memory-api";
import { formatDateTime } from "@/lib/format";
import type { MemoryFact } from "@/lib/types";

type Props = {
  facts: MemoryFact[];
  loading: boolean;
  error: string | null;
  onDeleted: (id: string) => void;
  onRetry: () => void;
};

export function MemoryPanel({ facts, loading, error, onDeleted, onRetry }: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const target = facts.find((item) => item.id === pendingId) ?? null;

  async function confirmDelete() {
    if (!target) return;
    setConfirming(true);
    setActionError(null);
    const result = await deleteMemory(target.id);
    setConfirming(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    onDeleted(target.id);
    setPendingId(null);
  }

  if (loading) {
    return (
      <p className="px-2 py-4 text-sm text-content-muted" role="status">
        {copy.chat.memoryLoading}
      </p>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3 px-1 py-2">
        <p className="text-sm text-content-muted">{error}</p>
        <Button variant="secondary" tooltip={copy.chat.tipMemoryRetry} onClick={onRetry}>
          {copy.chat.memoryRetry}
        </Button>
      </div>
    );
  }

  if (!facts.length) {
    return <EmptyState title={copy.chat.memoryEmptyTitle} body={copy.chat.memoryEmptyBody} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-content-muted">{copy.chat.memoryLead}</p>
      {actionError ? (
        <p className="text-sm font-medium text-accent-hover" role="alert">
          {actionError}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {facts.map((fact) => (
          <li key={fact.id}>
            <Surface elevation="pressed" radius="surface" className="flex flex-col gap-2 p-3">
              <p className="text-xs font-semibold text-content-muted">{labelKey(fact.cle)}</p>
              <p className="text-sm">{fact.valeur}</p>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-content-muted">{formatDateTime(fact.dateMaj)}</p>
                <Button
                  variant="danger"
                  tooltip={copy.chat.tipMemoryDelete}
                  onClick={() => setPendingId(fact.id)}
                >
                  {copy.chat.memoryDelete}
                </Button>
              </div>
            </Surface>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={Boolean(target)}
        title={copy.chat.memoryDeleteTitle}
        body={copy.chat.memoryDeleteBody}
        confirmLabel={copy.chat.memoryDeleteConfirm}
        pending={confirming}
        danger
        onConfirm={() => void confirmDelete()}
        onClose={() => {
          if (!confirming) setPendingId(null);
        }}
      />
    </div>
  );
}

function labelKey(cle: string): string {
  const known = (copy.chat.memoryKeys as Record<string, string>)[cle];
  if (known) return known;
  return cle.replace(/_/g, " ");
}
