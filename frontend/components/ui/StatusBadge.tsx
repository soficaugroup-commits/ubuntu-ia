import { copy } from "@/content/fr";
import type { IndexationStatus, ReviewStatus } from "@/lib/types";

const styles: Record<IndexationStatus | ReviewStatus, string> = {
  en_attente: "neo-soft text-content",
  en_cours: "neo-pressed text-content",
  termine: "bg-brand text-inverse neo-bubble",
  erreur: "bg-accent text-brand neo-gold",
  ok: "bg-brand text-inverse neo-bubble",
  corrige: "neo-pressed text-content",
  a_verifier: "bg-accent text-brand neo-gold",
};

type Props = {
  status: IndexationStatus | ReviewStatus;
};

function labelOf(status: IndexationStatus | ReviewStatus): string {
  if (status === "ok" || status === "corrige" || status === "a_verifier") {
    return copy.chat.review[status];
  }
  return copy.admin.status[status];
}

export function StatusBadge({ status }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${styles[status]}`}
    >
      {labelOf(status)}
    </span>
  );
}
