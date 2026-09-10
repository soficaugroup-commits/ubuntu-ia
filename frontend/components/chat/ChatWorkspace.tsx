"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnswerBody } from "@/components/chat/AnswerBody";
import { AnswerProgress } from "@/components/chat/AnswerProgress";
import { Composer, type ComposerHandle } from "@/components/chat/Composer";
import { CopyAnswerButton } from "@/components/chat/CopyAnswerButton";
import { FeedbackButtons } from "@/components/chat/FeedbackButtons";
import { UserTurn } from "@/components/chat/UserTurn";
import { GeneratedFiles } from "@/components/chat/GeneratedFiles";
import { MemoryPanel } from "@/components/chat/MemoryPanel";
import { SourceCitations } from "@/components/chat/SourceCitations";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Sheet } from "@/components/ui/Sheet";
import { Surface } from "@/components/ui/Surface";
import { Tooltip } from "@/components/ui/Tooltip";
import { IconHistory, IconMemory, IconPencil, IconTrash } from "@/components/ui/icons";
import { copy } from "@/content/fr";
import {
  compactTools,
  createPendingAssistant,
  createUserMessage,
  titleFromQuestion,
} from "@/lib/chat";
import {
  streamAnswer,
  deleteConversation,
  loadConversations,
  renameConversation,
} from "@/lib/chat-api";
import { interpolate } from "@/lib/format";
import { loadOwnFeedback } from "@/lib/feedback-api";
import { loadMemory } from "@/lib/memory-api";
import { requestCanvas } from "@/lib/model-intents";
import type {
  ChatAttachment,
  ChatMessage,
  ChatStep,
  ChatTools,
  Conversation,
  MemoryFact,
  MessageFeedback,
} from "@/lib/types";
import type { ChatStreamEvent } from "@/lib/chat-stream-events";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";

function createConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: copy.chat.untitled,
    updatedAt: new Date().toISOString(),
    messages: [],
  };
}

export function ChatWorkspace() {
  const composerRef = useRef<ComposerHandle>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [historyState, setHistoryState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryFacts, setMemoryFacts] = useState<MemoryFact[]>([]);
  const [memoryState, setMemoryState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [feedbackByMessage, setFeedbackByMessage] = useState<
    Record<string, MessageFeedback>
  >({});
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await loadConversations();
      if (cancelled) return;
      if (!result.ok) {
        setHistoryState("error");
        return;
      }
      if (result.conversations.length === 0) {
        const first = createConversation();
        setConversations([first]);
        setActiveId(first.id);
      } else {
        setConversations(result.conversations);
        setActiveId(result.conversations[0].id);
      }
      setHistoryState("ready");
      const votes = await loadOwnFeedback();
      if (cancelled || !votes.ok) return;
      const mapped: Record<string, MessageFeedback> = {};
      for (const item of votes.feedbacks) {
        if (item.messageId) mapped[item.messageId] = item;
      }
      setFeedbackByMessage(mapped);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onOnline() {
      setOnline(true);
    }
    function onOffline() {
      setOnline(false);
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const active = useMemo(
    () => conversations.find((item) => item.id === activeId) ?? null,
    [conversations, activeId],
  );
  const sending = Boolean(
    active?.messages.some(
      (message) => message.role === "assistant" && message.status === "pending",
    ),
  );

  useEffect(() => {
    setEditingUserId(null);
  }, [activeId]);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [active?.messages, sending]);

  function updateActive(updater: (conversation: Conversation) => Conversation) {
    setConversations((current) =>
      current.map((item) => (item.id === activeId ? updater(item) : item)),
    );
  }

  async function openMemory() {
    setMemoryOpen(true);
    setMemoryState("loading");
    setMemoryError(null);
    const result = await loadMemory();
    if (!result.ok) {
      setMemoryError(result.error);
      setMemoryState("error");
      return;
    }
    setMemoryFacts(result.facts);
    setMemoryState("ready");
  }

  function startConversation() {
    const next = createConversation();
    setConversations((current) => [next, ...current]);
    setActiveId(next.id);
    setHistoryOpen(false);
    composerRef.current?.reset();
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  async function removeConversation(id: string): Promise<
    { ok: true } | { ok: false; error: string }
  > {
    const target = conversations.find((item) => item.id === id);
    if (!target) {
      return { ok: false, error: copy.chat.deleteConversationError };
    }
    if (id === activeId && sending) {
      abortRef.current?.abort("stopped");
      abortRef.current = null;
    }
    if (target.messages.length > 0) {
      const result = await deleteConversation(id);
      if (!result.ok) return result;
    }
    const remaining = conversations.filter((item) => item.id !== id);
    if (remaining.length === 0) {
      const fresh = createConversation();
      setConversations([fresh]);
      setActiveId(fresh.id);
    } else {
      setConversations(remaining);
      if (id === activeId) {
        setActiveId(remaining[0].id);
      }
    }
    if (id === activeId) {
      composerRef.current?.reset();
    }
    return { ok: true };
  }

  async function renameActiveConversation(
    id: string,
    title: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const target = conversations.find((item) => item.id === id);
    if (!target) {
      return { ok: false, error: copy.chat.renameConversationError };
    }
    const cleaned = title.trim().replace(/\s+/g, " ");
    if (!cleaned) {
      return { ok: false, error: copy.chat.renameConversationEmpty };
    }
    if (target.messages.length === 0) {
      setConversations((current) =>
        current.map((item) =>
          item.id === id
            ? { ...item, title: cleaned.slice(0, 80), titleLocked: true }
            : item,
        ),
      );
      return { ok: true };
    }
    const result = await renameConversation(id, cleaned);
    if (!result.ok) return result;
    setConversations((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, title: result.title, titleLocked: result.titleLocked }
          : item,
      ),
    );
    return { ok: true };
  }

  function replaceAssistant(assistantId: string, next: ChatMessage) {
    updateActive((conversation) => ({
      ...conversation,
      updatedAt: new Date().toISOString(),
      messages: conversation.messages.map((message) =>
        message.id === assistantId ? next : message,
      ),
    }));
  }

  function appendVoiceTurn(user: string, assistant: string) {
    const spokenUser = user.trim();
    const spokenAssistant = assistant.trim();
    if (!spokenUser && !spokenAssistant) return;
    updateActive((conversation) => {
      const now = new Date().toISOString();
      const messages = [...conversation.messages];
      if (spokenUser) messages.push(createUserMessage(spokenUser));
      if (spokenAssistant) {
        messages.push({
          id: crypto.randomUUID(),
          role: "assistant",
          content: spokenAssistant,
          sources: [],
          status: "answered",
          createdAt: now,
        });
      }
      return {
        ...conversation,
        title:
          conversation.messages.length === 0 && spokenUser && !conversation.titleLocked
            ? titleFromQuestion(spokenUser)
            : conversation.title,
        updatedAt: now,
        messages,
      };
    });
  }

  function ask(
    question: string,
    attachments: ChatAttachment[] = [],
    assistantId?: string,
    tools: ChatTools = {},
    replaceUserId?: string,
  ) {
    const storedAttachments = attachments.map((item) => ({
      id: item.id,
      name: item.name,
      mime: item.mime,
      size: item.size,
      kind: item.kind,
      previewUrl: item.previewUrl,
    }));
    const pending = createPendingAssistant({
      attachments: storedAttachments.length > 0,
    });
    const retrying = Boolean(assistantId) && !replaceUserId;
    const targetId = retrying ? assistantId! : pending.id;
    const pendingMessage: ChatMessage = retrying
      ? { ...pending, id: assistantId! }
      : pending;

    if (replaceUserId) {
      abortRef.current?.abort("replaced");
      abortRef.current = null;
      updateActive((conversation) => {
        const index = conversation.messages.findIndex((item) => item.id === replaceUserId);
        const previous = conversation.messages[index];
        if (index < 0 || previous?.role !== "user") return conversation;
        const updatedUser: ChatMessage = {
          ...previous,
          content: question,
          attachments: storedAttachments.length ? storedAttachments : undefined,
          tools: compactTools(tools) ?? previous.tools,
        };
        return {
          ...conversation,
          title:
            index === 0 && !conversation.titleLocked
              ? titleFromQuestion(question)
              : conversation.title,
          updatedAt: new Date().toISOString(),
          messages: [...conversation.messages.slice(0, index), updatedUser, pending],
        };
      });
      setEditingUserId(null);
    } else if (!assistantId) {
      updateActive((conversation) => ({
        ...conversation,
        title:
          conversation.messages.length === 0 && !conversation.titleLocked
            ? titleFromQuestion(question)
            : conversation.title,
        updatedAt: new Date().toISOString(),
        messages: [
          ...conversation.messages,
          createUserMessage(question, storedAttachments, tools),
          pending,
        ],
      }));
    } else {
      replaceAssistant(targetId, pendingMessage);
    }
    composerRef.current?.handleAssistant(
      pendingMessage as Extract<ChatMessage, { role: "assistant" }>,
    );

    if (!online) {
      const offline: ChatMessage = {
        id: targetId,
        role: "assistant",
        content: "",
        sources: [],
        status: "offline",
        createdAt: new Date().toISOString(),
      };
      replaceAssistant(targetId, offline);
      composerRef.current?.handleAssistant(offline);
      return;
    }

    abortRef.current?.abort("replaced");
    const controller = new AbortController();
    abortRef.current = controller;
    const imageWait =
      attachments.some((item) => item.kind === "image") || Boolean(tools.image);
    const timeout = window.setTimeout(
      () => controller.abort("timeout"),
      imageWait ? 200_000 : 120_000,
    );

    const snapshot = conversations.find((item) => item.id === activeId);
    const history = (() => {
      if (replaceUserId) {
        const index = snapshot?.messages.findIndex((item) => item.id === replaceUserId) ?? -1;
        const previous = index >= 0 ? snapshot?.messages[index] : undefined;
        const updatedUser: ChatMessage =
          previous?.role === "user"
            ? {
                ...previous,
                content: question,
                attachments: storedAttachments.length ? storedAttachments : undefined,
                tools: compactTools(tools) ?? previous.tools,
              }
            : createUserMessage(question, storedAttachments, tools);
        return [...(snapshot?.messages.slice(0, Math.max(index, 0)) ?? []), updatedUser];
      }
      if (retrying) {
        return snapshot?.messages.filter((item) => item.id !== assistantId) ?? [];
      }
      return [
        ...(snapshot?.messages ?? []),
        createUserMessage(question, storedAttachments, tools),
      ];
    })();

    void (async () => {
      try {
        const result = await streamAnswer(
          question,
          activeId ?? crypto.randomUUID(),
          history,
          attachments,
          controller.signal,
          tools,
          (event) => applyStreamEvent(targetId, event),
        );
        if (controller.signal.aborted) return;
        if (!result.ok) {
          let nextMessage: Extract<ChatMessage, { role: "assistant" }> | null = null;
          updateActive((conversation) => ({
            ...conversation,
            messages: conversation.messages.map((message) => {
              if (message.id !== targetId || message.role !== "assistant") return message;
              nextMessage = message.content.trim()
                ? { ...message, status: "answered" }
                : {
                    ...message,
                    status: result.timeout ? "timeout" : "error",
                  };
              return nextMessage;
            }),
          }));
          if (nextMessage) composerRef.current?.handleAssistant(nextMessage);
          return;
        }
      } catch {
        if (controller.signal.aborted && controller.signal.reason !== "timeout") {
          return;
        }
        let nextMessage: Extract<ChatMessage, { role: "assistant" }> | null = null;
        updateActive((conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) => {
            if (message.id !== targetId || message.role !== "assistant") return message;
            nextMessage = message.content.trim()
              ? { ...message, status: "answered" }
              : {
                  ...message,
                  status: controller.signal.reason === "timeout" ? "timeout" : "error",
                };
            return nextMessage;
          }),
        }));
        if (nextMessage) composerRef.current?.handleAssistant(nextMessage);
      } finally {
        window.clearTimeout(timeout);
        if (abortRef.current === controller) abortRef.current = null;
      }
    })();
  }

  function applyStreamEvent(assistantId: string, event: ChatStreamEvent) {
    let nextMessage: Extract<ChatMessage, { role: "assistant" }> | null = null;
    updateActive((conversation) => ({
      ...conversation,
      updatedAt: new Date().toISOString(),
      messages: conversation.messages.map((message) => {
        if (message.id !== assistantId || message.role !== "assistant") return message;
        nextMessage = reduceAssistant(message, event);
        return nextMessage;
      }),
    }));
    if ((event.type === "fin" || event.type === "erreur") && nextMessage) {
      composerRef.current?.handleAssistant(nextMessage);
    }
  }

  function stop() {
    abortRef.current?.abort("stopped");
    abortRef.current = null;
    const pending = active?.messages.find(
      (message) => message.role === "assistant" && message.status === "pending",
    );
    if (!pending || pending.role !== "assistant") return;
    const stopped: ChatMessage = {
      ...pending,
      status: pending.content.trim() ? "answered" : "stopped",
    };
    replaceAssistant(pending.id, stopped);
    composerRef.current?.handleAssistant(stopped);
  }

  function retry(message: ChatMessage, conversation: Conversation) {
    const index = conversation.messages.findIndex((item) => item.id === message.id);
    const previous = conversation.messages[index - 1];
    if (previous?.role !== "user") return;
    ask(previous.content, previous.attachments, message.id, previous.tools);
  }

  if (historyState === "loading") {
    return (
      <Surface
        elevation="soft"
        radius="card"
        className="m-3 flex-1 px-5 py-10 text-content-muted sm:m-4"
        role="status"
      >
        {copy.chat.historyLoading}
      </Surface>
    );
  }

  if (historyState === "error") {
    return (
      <div className="flex-1 overflow-y-auto p-3 sm:p-4">
        <Alert
          tone="danger"
          title={copy.chat.historyErrorTitle}
          body={copy.chat.historyErrorBody}
          action={
            <Button
              variant="secondary"
              tooltip={copy.chat.tipRetryHistory}
              onClick={() => {
                setHistoryState("loading");
                void (async () => {
                  const result = await loadConversations();
                  if (!result.ok) {
                    setHistoryState("error");
                    return;
                  }
                  if (result.conversations.length === 0) {
                    const first = createConversation();
                    setConversations([first]);
                    setActiveId(first.id);
                  } else {
                    setConversations(result.conversations);
                    setActiveId(result.conversations[0].id);
                  }
                  setHistoryState("ready");
                })();
              }}
            >
              {copy.chat.retryHistory}
            </Button>
          }
        />
      </div>
    );
  }

  const history = (
    <ConversationHistory
      conversations={conversations}
      activeId={activeId}
      onSelect={(id) => {
        setActiveId(id);
        setHistoryOpen(false);
      }}
      onCreate={startConversation}
      onMemory={() => void openMemory()}
      onRename={(id, title) => renameActiveConversation(id, title)}
      onDelete={(id) => removeConversation(id)}
    />
  );

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-1 overflow-hidden gap-3 px-3 pb-3 sm:gap-4 sm:px-4 sm:pb-4">
      <Surface
        as="aside"
        elevation="raised"
        radius="card"
        className="hidden w-60 min-h-0 shrink-0 overflow-hidden md:flex md:flex-col lg:w-72"
      >
        {history}
      </Surface>

      <Surface
        as="section"
        elevation="raised"
        radius="card"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <div className="flex shrink-0 items-center gap-2 px-3 py-3 sm:px-5 sm:py-4 md:hidden">
          <Button
            variant="secondary"
            size="icon"
            aria-label={copy.chat.historyOpen}
            tooltip={copy.chat.tipHistoryOpen}
            onClick={() => setHistoryOpen(true)}
          >
            <IconHistory />
          </Button>
          <h1 className="min-w-0 flex-1 truncate font-semibold">{copy.chat.pageTitle}</h1>
          <Button
            variant="secondary"
            size="icon"
            aria-label={copy.chat.memoryOpen}
            tooltip={copy.chat.tipMemoryOpen}
            onClick={() => void openMemory()}
          >
            <IconMemory />
          </Button>
          <Button variant="secondary" tooltip={copy.chat.tipNewConversation} onClick={startConversation}>
            <span className="sm:hidden">{copy.chat.newConversationShort}</span>
            <span className="hidden sm:inline">{copy.chat.newConversation}</span>
          </Button>
        </div>

        {!online ? (
          <Surface
            elevation="gold"
            radius="pill"
            className="mx-3 mt-2 px-4 py-2 text-sm font-medium text-content sm:mx-4"
          >
            {copy.chat.offlineBanner}
          </Surface>
        ) : null}

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4 sm:py-6">
          {active && active.messages.length === 0 ? (
            <EmptyState
              title={copy.chat.emptyTitle}
              body={copy.chat.emptyBody}
              hint={copy.chat.emptyHint}
            />
          ) : (
            <ol className="mx-auto flex max-w-3xl flex-col gap-5 pb-2">
              {active?.messages.map((message, index) => (
                <li key={message.id}>
                  {message.role === "user" ? (
                    <UserTurn
                      message={message}
                      editing={editingUserId === message.id}
                      online={online}
                      onStartEdit={() => setEditingUserId(message.id)}
                      onCancelEdit={() => setEditingUserId(null)}
                      onResend={(question) =>
                        ask(
                          question,
                          message.attachments ?? [],
                          undefined,
                          message.tools ?? {},
                          message.id,
                        )
                      }
                    />
                  ) : (
                    <AssistantTurn
                      message={message}
                      canvas={isCanvasTurn(active.messages[index - 1])}
                      conversationId={active.id}
                      messageIndex={index}
                      previous={active.messages[index - 1]}
                      feedback={feedbackByMessage[message.id]}
                      onFeedback={(item) => {
                        if (!item.messageId) return;
                        setFeedbackByMessage((current) => ({
                          ...current,
                          [item.messageId!]: item,
                        }));
                      }}
                      onRetry={() => active && retry(message, active)}
                      onReformulate={() => composerRef.current?.focus()}
                    />
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        <Composer
          ref={composerRef}
          online={online}
          sending={sending}
          conversationId={active?.id ?? ""}
          messages={active?.messages ?? []}
          onSubmitQuestion={(question, attachments, tools) =>
            ask(question, attachments, undefined, tools)
          }
          onVoiceTurn={appendVoiceTurn}
          onStop={stop}
        />
      </Surface>

      <Sheet
        open={historyOpen}
        title={copy.chat.sidebarLabel}
        side="left"
        onClose={() => setHistoryOpen(false)}
      >
        {history}
      </Sheet>
      <Sheet
        open={memoryOpen}
        title={copy.chat.memoryTitle}
        side="right"
        onClose={() => setMemoryOpen(false)}
      >
        <div className="px-4 py-4">
          <MemoryPanel
            facts={memoryFacts}
            loading={memoryState === "loading" || memoryState === "idle"}
            error={memoryError}
            onDeleted={(id) =>
              setMemoryFacts((current) => current.filter((item) => item.id !== id))
            }
            onRetry={() => void openMemory()}
          />
        </div>
      </Sheet>
    </div>
  );
}

function isCanvasTurn(message: ChatMessage | undefined): boolean {
  return message?.role === "user" && requestCanvas(message.content, message.tools);
}

function ConversationHistory({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onMemory,
  onRename,
  onDelete,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onMemory: () => void;
  onRename: (
    id: string,
    title: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onDelete: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const target = conversations.find((item) => item.id === pendingId) ?? null;
  const renamingTarget = conversations.find((item) => item.id === renamingId) ?? null;

  async function confirmDelete() {
    if (!target) return;
    setConfirming(true);
    setActionError(null);
    const result = await onDelete(target.id);
    setConfirming(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setPendingId(null);
  }

  async function confirmRename() {
    if (!renamingTarget) return;
    setRenaming(true);
    setRenameError(null);
    const result = await onRename(renamingTarget.id, renameValue);
    setRenaming(false);
    if (!result.ok) {
      setRenameError(result.error);
      return;
    }
    setRenamingId(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 p-4 pb-2">
        <Button className="w-full" tooltip={copy.chat.tipNewConversation} onClick={onCreate}>
          {copy.chat.newConversation}
        </Button>
      </div>
      <nav aria-label={copy.chat.sidebarLabel} className="min-h-0 flex-1 overflow-y-auto px-3">
        {actionError ? (
          <p className="px-2 pb-2 text-sm font-medium text-accent-hover" role="alert">
            {actionError}
          </p>
        ) : null}
        {conversations.length === 0 ? (
          <p className="px-2 py-3 text-sm text-content-muted">
            {copy.chat.noConversations}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {conversations.map((item) => (
              <li key={item.id} className="flex items-center gap-1">
                <Tooltip label={copy.chat.tipOpenConversation} className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className={`w-full rounded-surface px-4 py-3 text-left text-sm font-medium ${
                      item.id === activeId
                        ? "neo-pressed text-content"
                        : "text-content-muted hover:text-content"
                    }`}
                  >
                    <span className="block truncate">{item.title}</span>
                  </button>
                </Tooltip>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={copy.chat.renameConversation}
                  tooltip={copy.chat.tipRenameConversation}
                  onClick={() => {
                    setRenamingId(item.id);
                    setRenameValue(item.title === copy.chat.untitled ? "" : item.title);
                    setRenameError(null);
                  }}
                >
                  <IconPencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={copy.chat.deleteConversation}
                  tooltip={copy.chat.tipDeleteConversation}
                  onClick={() => setPendingId(item.id)}
                >
                  <IconTrash />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <div className="shrink-0 p-4 pt-2">
        <Button
          className="w-full"
          variant="secondary"
          tooltip={copy.chat.tipMemoryOpen}
          onClick={onMemory}
        >
          {copy.chat.memoryOpen}
        </Button>
      </div>
      {renamingTarget ? (
        <Dialog
          open
          title={copy.chat.renameConversationTitle}
          onClose={() => {
            if (!renaming) setRenamingId(null);
          }}
        >
          <form
            className="mt-4 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmRename();
            }}
          >
            <TextField
              id="rename-conversation"
              label={copy.chat.renameConversationLabel}
              hint={copy.chat.renameConversationHint}
              value={renameValue}
              error={renameError ?? undefined}
              onChange={(event) => setRenameValue(event.target.value)}
              autoComplete="off"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={renaming}
                onClick={() => setRenamingId(null)}
              >
                {copy.admin.confirm.cancel}
              </Button>
              <Button type="submit" pending={renaming}>
                {renaming
                  ? copy.chat.renameConversationPending
                  : copy.chat.renameConversationConfirm}
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
      {target ? (
        <ConfirmDialog
          open
          title={copy.chat.deleteConversationTitle}
          body={interpolate(
            copy.chat.deleteConversationBody ??
              "« {title} » sera retirée de votre historique. Les messages disparaîtront. Cette action est irréversible.",
            { title: target.title || copy.chat.untitled },
          )}
          confirmLabel={copy.chat.deleteConversationConfirm}
          pending={confirming}
          pendingLabel={copy.chat.deleteConversationPending}
          danger
          onConfirm={() => void confirmDelete()}
          onClose={() => {
            if (!confirming) setPendingId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function AssistantTurn({
  message,
  canvas,
  conversationId,
  messageIndex,
  previous,
  feedback,
  onFeedback,
  onRetry,
  onReformulate,
}: {
  message: Extract<ChatMessage, { role: "assistant" }>;
  canvas?: boolean;
  conversationId: string;
  messageIndex: number;
  previous?: ChatMessage;
  feedback?: MessageFeedback;
  onFeedback: (item: MessageFeedback) => void;
  onRetry: () => void;
  onReformulate: () => void;
}) {
  if (message.status === "pending") {
    const hasText = Boolean(message.content.trim());
    const writing = message.steps?.some((step) => step.id === "write" && step.state === "running");
    return (
      <Surface
        as="article"
        elevation="soft"
        radius="bubble"
        className="max-w-[92%] px-4 py-4 text-content sm:max-w-[85%] sm:px-5 sm:py-5"
        aria-busy="true"
        aria-live="polite"
      >
        <AnswerProgress steps={message.steps ?? []} collapsed={false} />
        {hasText || writing ? (
          <div className="mt-4">
            <AnswerBody
              content={message.content}
              messageId={message.id}
              sourceCount={message.sources.length}
              streaming
            />
          </div>
        ) : null}
      </Surface>
    );
  }

  if (message.status === "no_source") {
    return (
      <Alert
        tone="info"
        title={copy.chat.noSourceTitle}
        body={copy.chat.noSourceBody}
        action={
          <Button variant="secondary" tooltip={copy.chat.tipReformulate} onClick={onReformulate}>
            {copy.chat.noSourceAction}
          </Button>
        }
      />
    );
  }

  if (message.status === "error") {
    return (
      <Alert
        tone="danger"
        title={copy.chat.errorTitle}
        body={copy.chat.errorBody}
        live="assertive"
        action={
          <Button variant="secondary" tooltip={copy.chat.tipRetryAnswer} onClick={onRetry}>
            {copy.chat.retryAnswer}
          </Button>
        }
      />
    );
  }

  if (message.status === "stopped") {
    return (
      <Alert
        tone="info"
        title={copy.chat.stoppedTitle}
        body={copy.chat.stoppedBody}
        action={
          <Button variant="secondary" tooltip={copy.chat.tipRetryAnswer} onClick={onRetry}>
            {copy.chat.retryAnswer}
          </Button>
        }
      />
    );
  }

  if (message.status === "timeout") {
    return (
      <Alert
        tone="danger"
        title={copy.chat.timeoutTitle}
        body={copy.chat.timeoutBody}
        live="assertive"
        action={
          <Button variant="secondary" tooltip={copy.chat.tipRetryAnswer} onClick={onRetry}>
            {copy.chat.retryAnswer}
          </Button>
        }
      />
    );
  }

  if (message.status === "offline") {
    return (
      <Alert
        tone="danger"
        title={copy.chat.offlineTitle}
        body={copy.chat.offlineBody}
        action={
          <Button variant="secondary" tooltip={copy.chat.tipRetryAnswer} onClick={onRetry}>
            {copy.chat.retryAnswer}
          </Button>
        }
      />
    );
  }

  return (
    <Surface
      as="article"
      elevation="soft"
      radius="bubble"
      className="max-w-[92%] px-5 py-5 sm:max-w-[88%] sm:px-6 sm:py-6"
    >
      {message.steps?.length ? (
        <AnswerProgress steps={message.steps} collapsed />
      ) : null}
      <div className="mb-3 flex justify-end">
        <CopyAnswerButton content={message.content} />
      </div>
      {canvas ? (
        <p className="mb-3 text-sm font-semibold">{copy.chat.canvasHeading}</p>
      ) : null}
      <AnswerBody
        content={message.content}
        messageId={message.id}
        sourceCount={message.sources.length}
      />
      <GeneratedFiles files={message.files} images={message.images} />
      <SourceCitations messageId={message.id} sources={message.sources} />
      <div className="mt-4">
        <FeedbackButtons
          conversationId={conversationId}
          messageId={message.id}
          messageIndex={messageIndex}
          extraitQuestion={previous?.role === "user" ? previous.content : undefined}
          extraitReponse={message.content}
          current={feedback}
          onRecorded={onFeedback}
        />
      </div>
    </Surface>
  );
}

function reduceAssistant(
  message: Extract<ChatMessage, { role: "assistant" }>,
  event: ChatStreamEvent,
): Extract<ChatMessage, { role: "assistant" }> {
  if (event.type === "etape") {
    return { ...message, steps: upsertStep(message.steps, event) };
  }
  if (event.type === "token") {
    return { ...message, content: `${message.content}${event.content}` };
  }
  if (event.type === "sources") {
    return { ...message, sources: event.documents };
  }
  if (event.type === "images") {
    return { ...message, images: event.images };
  }
  if (event.type === "files") {
    return { ...message, files: event.files };
  }
  if (event.type === "erreur") {
    return message;
  }
  if (event.type === "fin") {
    const nextContent = event.content?.trim() ? event.content : message.content;
    const hasText = Boolean(nextContent.trim());
    const status = hasText
      ? "answered"
      : event.status === "no_source"
        ? "no_source"
        : "error";
    return {
      ...message,
      content: nextContent,
      status,
    };
  }
  return message;
}

function upsertStep(
  steps: ChatStep[] | undefined,
  event: Extract<ChatStreamEvent, { type: "etape" }>,
): ChatStep[] {
  const current = steps ?? [];
  const next: ChatStep = { id: event.id, label: event.label, state: event.state };
  const index = current.findIndex((step) => step.id === event.id);
  if (index < 0) return [...current, next];
  return current.map((step, position) => (position === index ? next : step));
}
