"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CopyAnswerButton } from "@/components/chat/CopyAnswerButton";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { TextField } from "@/components/ui/TextField";
import { IconFile, IconPencil } from "@/components/ui/icons";
import { copy } from "@/content/fr";
import type { ChatAttachment, ChatMessage } from "@/lib/types";

type UserMessage = Extract<ChatMessage, { role: "user" }>;

type Props = {
  message: UserMessage;
  editing: boolean;
  online: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onResend: (question: string) => void;
};

function AttachmentList({ attachments }: { attachments: ChatAttachment[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-2">
      {attachments.map((item) => (
        <li key={item.id} className="flex items-center gap-2">
          {item.kind === "image" && item.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.previewUrl}
              alt={item.name}
              className="max-h-32 max-w-[12rem] rounded-[16px] object-cover"
            />
          ) : (
            <span className="inline-flex items-center gap-1 text-sm">
              <IconFile className="size-4" />
              {item.name}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function UserTurn({
  message,
  editing,
  online,
  onStartEdit,
  onCancelEdit,
  onResend,
}: Props) {
  const fieldId = useId();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(message.content);
  const hasAttachments = Boolean(message.attachments?.length);
  const trimmed = draft.trim();
  const canSend = online && (Boolean(trimmed) || hasAttachments);

  useEffect(() => {
    if (editing) {
      setDraft(message.content);
      window.requestAnimationFrame(() => {
        areaRef.current?.focus();
        const length = areaRef.current?.value.length ?? 0;
        areaRef.current?.setSelectionRange(length, length);
      });
    }
  }, [editing, message.content]);

  function submit() {
    if (!canSend) return;
    const question = trimmed || (hasAttachments ? copy.chat.attachmentOnlyPrompt : "");
    if (!question) return;
    onResend(question);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancelEdit();
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  }

  if (editing) {
    return (
      <div className="ml-auto w-full max-w-[92%] sm:max-w-[85%]">
        <Surface elevation="raised" radius="bubble" className="p-4 sm:p-5">
          {hasAttachments && message.attachments ? (
            <AttachmentList attachments={message.attachments} />
          ) : null}
          <TextField
            id={fieldId}
            label={copy.chat.editQuestionLabel}
            hint={online ? copy.chat.editQuestionHint : copy.chat.editQuestionOffline}
            multiline
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            controlRef={areaRef}
          />
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onCancelEdit}
              tooltip={copy.chat.tipCancelEdit}
            >
              {copy.chat.cancelEdit}
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={!canSend}
              tooltip={copy.chat.tipResendQuestion}
            >
              {copy.chat.resendQuestion}
            </Button>
          </div>
        </Surface>
      </div>
    );
  }

  return (
    <div className="ml-auto flex w-fit max-w-[92%] flex-col items-end sm:max-w-[85%]">
      <Surface
        as="article"
        elevation="bubble"
        radius="bubble"
        className="w-fit max-w-full bg-brand px-4 py-3 text-inverse sm:px-5"
      >
        {hasAttachments && message.attachments ? (
          <AttachmentList attachments={message.attachments} />
        ) : null}
        {message.content ? (
          <p className="break-words">{message.content}</p>
        ) : null}
      </Surface>
      <div className="mt-2 flex items-center justify-end gap-1">
        <CopyAnswerButton content={message.content} mode="question" />
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={onStartEdit}
          aria-label={copy.chat.editQuestion}
          tooltip={copy.chat.tipEditQuestion}
        >
          <IconPencil className="size-5" />
        </Button>
      </div>
    </div>
  );
}
