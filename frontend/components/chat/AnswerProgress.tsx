"use client";

import { copy } from "@/content/fr";
import type { ChatStep } from "@/lib/types";

type Props = {
  steps: ChatStep[];
  collapsed?: boolean;
};

export function AnswerProgress({ steps, collapsed = false }: Props) {
  if (!steps.length) {
    return (
      <p className="flex items-center gap-2 text-sm text-content-muted" aria-live="polite">
        <span className="stream-dots is-live" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {copy.chat.pendingAnnouncement}
      </p>
    );
  }

  const list = <StepList steps={steps} />;
  if (!collapsed) return list;

  return (
    <details className="source-disclosure mb-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-content-muted">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="source-chevron size-4 shrink-0"
        >
          <path
            d="m6 9 6 6 6-6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {copy.chat.stepsToggle}
      </summary>
      <div className="source-disclosure-panel mt-2">{list}</div>
    </details>
  );
}

function StepList({ steps }: { steps: ChatStep[] }) {
  return (
    <ol className="flex flex-col gap-2" aria-live="polite">
      {steps.map((step) => {
        const active = step.state === "running";
        return (
          <li
            key={step.id}
            className={`flex items-start gap-2 text-sm ${
              active ? "font-medium text-content" : "text-content-muted"
            }`}
          >
            <StepMark state={step.state} />
            <span>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function StepMark({ state }: { state: ChatStep["state"] }) {
  if (state === "running") {
    return (
      <span className="stream-dots is-live mt-2" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    );
  }
  if (state === "queued") {
    return (
      <span
        className="mt-0.5 inline-flex size-4 shrink-0 rounded-full bg-brand-subtle"
        aria-hidden="true"
      />
    );
  }
  if (state === "empty" || state === "error") {
    return (
      <span
        className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[0.65rem] font-bold text-accent-hover"
        aria-hidden="true"
      >
        !
      </span>
    );
  }
  return (
    <span
      className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-[0.65rem] font-bold text-brand"
      aria-hidden="true"
    >
      ✓
    </span>
  );
}
