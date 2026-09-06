import type { ReactNode } from "react";
import { Surface } from "@/components/ui/Surface";

type Tone = "info" | "danger" | "neutral";

type Props = {
  title: string;
  body?: string;
  tone?: Tone;
  action?: ReactNode;
  live?: "polite" | "assertive";
};

const tones: Record<Tone, { elevation: "raised" | "soft"; className: string }> = {
  info: { elevation: "raised", className: "" },
  danger: { elevation: "raised", className: "bg-accent-subtle" },
  neutral: { elevation: "soft", className: "" },
};

export function Alert({
  title,
  body,
  tone = "neutral",
  action,
  live = "polite",
}: Props) {
  const look = tones[tone];
  return (
    <Surface
      elevation={look.elevation}
      radius="card"
      className={`flex flex-col gap-3 px-5 py-4 ${look.className}`}
      role="status"
      aria-live={live}
    >
      <div>
        <p className="font-semibold text-content">{title}</p>
        {body ? <p className="mt-1 text-sm text-content-muted">{body}</p> : null}
      </div>
      {action}
    </Surface>
  );
}
