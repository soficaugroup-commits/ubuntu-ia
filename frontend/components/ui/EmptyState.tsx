import type { ReactNode } from "react";
import { Surface } from "@/components/ui/Surface";

type Props = {
  title: string;
  body: string;
  action?: ReactNode;
  hint?: string;
};

export function EmptyState({ title, body, action, hint }: Props) {
  return (
    <Surface elevation="soft" radius="card" className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-10">
      <h2 className="text-xl font-semibold text-content">{title}</h2>
      <p className="mt-3 text-content-muted">{body}</p>
      {hint ? <p className="mt-2 text-sm text-content-muted">{hint}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </Surface>
  );
}
