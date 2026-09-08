"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { IconThumbDown, IconThumbUp } from "@/components/ui/icons";
import { copy } from "@/content/fr";
import { submitFeedback } from "@/lib/feedback-api";
import type { FeedbackType, MessageFeedback } from "@/lib/types";

type Props = {
  conversationId: string;
  messageId: string;
  messageIndex: number;
  extraitQuestion?: string;
  extraitReponse?: string;
  current?: MessageFeedback;
  onRecorded: (item: MessageFeedback) => void;
};

export function FeedbackButtons({
  conversationId,
  messageId,
  messageIndex,
  extraitQuestion,
  extraitReponse,
  current,
  onRecorded,
}: Props) {
  const [pending, setPending] = useState<FeedbackType | null>(null);
  const [commentOpen, setCommentOpen] = useState(current?.type === "negatif");
  const [comment, setComment] = useState(current?.commentaire ?? "");
  const [error, setError] = useState<string | null>(null);

  async function vote(type: FeedbackType) {
    setPending(type);
    setError(null);
    if (type === "negatif") setCommentOpen(true);
    else setCommentOpen(false);
    const result = await submitFeedback({
      conversationId,
      messageId,
      messageIndex,
      type,
      commentaire: type === "negatif" ? comment : undefined,
      extraitQuestion,
      extraitReponse,
    });
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onRecorded(result.feedback);
  }

  async function sendComment() {
    if (current?.type !== "negatif" && pending !== "negatif") return;
    setPending("negatif");
    setError(null);
    const result = await submitFeedback({
      conversationId,
      messageId,
      messageIndex,
      type: "negatif",
      commentaire: comment,
      extraitQuestion,
      extraitReponse,
    });
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onRecorded(result.feedback);
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={copy.chat.feedbackUp}
          aria-pressed={current?.type === "positif"}
          tooltip={copy.chat.tipFeedbackUp}
          disabled={pending !== null}
          className={current?.type === "positif" ? "neo-pressed" : ""}
          onClick={() => void vote("positif")}
        >
          <IconThumbUp />
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={copy.chat.feedbackDown}
          aria-pressed={current?.type === "negatif"}
          tooltip={copy.chat.tipFeedbackDown}
          disabled={pending !== null}
          className={current?.type === "negatif" ? "neo-pressed" : ""}
          onClick={() => void vote("negatif")}
        >
          <IconThumbDown />
        </Button>
      </div>
      {commentOpen ? (
        <form
          className="flex w-full max-w-sm flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void sendComment();
          }}
        >
          <TextField
            id={`feedback-${messageId}`}
            label={copy.chat.feedbackCommentLabel}
            hint={copy.chat.feedbackCommentHint}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <Button
            type="submit"
            variant="secondary"
            pending={pending === "negatif"}
            tooltip={copy.chat.tipFeedbackComment}
          >
            {copy.chat.feedbackCommentSubmit}
          </Button>
        </form>
      ) : null}
      {error ? (
        <p className="text-xs font-medium text-accent-hover" role="status">
          {error}
        </p>
      ) : current ? (
        <p className="sr-only" role="status">
          {copy.chat.feedbackSaved}
        </p>
      ) : null}
    </div>
  );
}
