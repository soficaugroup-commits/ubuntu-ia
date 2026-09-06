import { copy } from "@/content/fr";
import type { IndexationStatus } from "@/lib/types";

const styles: Record<IndexationStatus, string> = {
  en_attente: "neo-soft text-content",
  en_cours: "neo-pressed text-content",
  termine: "bg-brand text-inverse neo-bubble",
  erreur: "bg-accent text-brand neo-gold",
};

type Props = {
  status: IndexationStatus;
};

export function StatusBadge({ status }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${styles[status]}`}
    >
      {copy.admin.status[status]}
    </span>
  );
}
