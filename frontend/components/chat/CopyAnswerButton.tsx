"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { IconCheck, IconCopy } from "@/components/ui/icons";
import { answerPlainText } from "@/components/chat/AnswerBody";
import { copy } from "@/content/fr";

type Status = "idle" | "copied" | "error";
type Mode = "answer" | "question";

type Props = {
  content: string;
  mode?: Mode;
};

export function CopyAnswerButton({ content, mode = "answer" }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const timerRef = useRef<number | null>(null);
  const isQuestion = mode === "question";
  const plain = isQuestion ? content.trim() : answerPlainText(content);
  const idleLabel = isQuestion ? copy.chat.copyQuestion : copy.chat.copyAnswer;
  const doneLabel = isQuestion ? copy.chat.copyQuestionDone : copy.chat.copyAnswerDone;
  const errorLabel = isQuestion ? copy.chat.copyQuestionError : copy.chat.copyAnswerError;
  const tooltip = isQuestion ? copy.chat.tipCopyQuestion : copy.chat.tipCopyAnswer;
  const label = status === "copied" ? doneLabel : idleLabel;

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function onCopy() {
    if (!plain) return;
    try {
      await navigator.clipboard.writeText(plain);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setStatus("idle"), 2500);
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {status === "error" ? (
        <p
          className="text-xs font-medium text-accent-hover"
          role="status"
          aria-live="assertive"
        >
          {errorLabel}
        </p>
      ) : (
        <p className="sr-only" role="status" aria-live="polite">
          {status === "copied" ? doneLabel : ""}
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        size="icon"
        onClick={() => void onCopy()}
        aria-label={label}
        tooltip={tooltip}
        disabled={!plain}
      >
        {status === "copied" ? (
          <IconCheck className="size-5 text-accent" />
        ) : (
          <IconCopy className="size-5" />
        )}
      </Button>
    </div>
  );
}
