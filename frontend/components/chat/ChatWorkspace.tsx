"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Composer, type ComposerHandle } from "@/components/chat/Composer";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Sheet } from "@/components/ui/Sheet";
import { Surface } from "@/components/ui/Surface";
import { IconFile, IconHistory } from "@/components/ui/icons";
import { copy } from "@/content/fr";
import {
  createPendingAssistant,
  createUserMessage,
  resolveAnswer,
  titleFromQuestion,
} from "@/lib/mock/chat";
import type { ChatAttachment, ChatMessage, Conversation } from "@/lib/types";

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
  const timerRef = useRef<number | null>(null);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [historyState, setHistoryState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const first = createConversation();
      setConversations([first]);
      setActiveId(first.id);
      setHistoryState("ready");
    }, 400);
    return () => window.clearTimeout(timer);
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
  const lastAssistant = useMemo(() => {
    const last = active?.messages.at(-1);
    return last?.role === "assistant" ? last : null;
  }, [active]);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [active?.messages.length, sending]);

  function updateActive(updater: (conversation: Conversation) => Conversation) {
    setConversations((current) =>
      current.map((item) => (item.id === activeId ? updater(item) : item)),
    );
  }

  function startConversation() {
    const next = createConversation();
    setConversations((current) => [next, ...current]);
    setActiveId(next.id);
    setHistoryOpen(false);
    composerRef.current?.reset();
    window.setTimeout(() => composerRef.current?.focus(), 0);
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

  function ask(question: string, attachments: ChatAttachment[] = [], assistantId?: string) {
    const scenario = resolveAnswer(question, online);
    const pending = assistantId ? null : createPendingAssistant();
    const targetId = assistantId ?? pending!.id;

    const pendingMessage: ChatMessage = pending ?? {
      id: targetId,
      role: "assistant",
      content: "",
      sources: [],
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    if (pending) {
      updateActive((conversation) => ({
        ...conversation,
        title:
          conversation.messages.length === 0
            ? titleFromQuestion(question)
            : conversation.title,
        updatedAt: new Date().toISOString(),
        messages: [
          ...conversation.messages,
          createUserMessage(question, attachments),
          pending,
        ],
      }));
    } else {
      replaceAssistant(targetId, pendingMessage);
    }
    composerRef.current?.handleAssistant(
      pendingMessage as Extract<ChatMessage, { role: "assistant" }>,
    );

    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const next: ChatMessage = {
        id: targetId,
        role: "assistant",
        content: scenario.content,
        sources: scenario.sources,
        status: scenario.status,
        createdAt: new Date().toISOString(),
      };
      replaceAssistant(targetId, next);
      composerRef.current?.handleAssistant(
        next as Extract<ChatMessage, { role: "assistant" }>,
      );
    }, scenario.delayMs);
  }

  function stop() {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = active?.messages.find(
      (message) => message.role === "assistant" && message.status === "pending",
    );
    if (!pending) return;
    const stopped: ChatMessage = {
      id: pending.id,
      role: "assistant",
      content: "",
      sources: [],
      status: "stopped",
      createdAt: pending.createdAt,
    };
    replaceAssistant(pending.id, stopped);
    composerRef.current?.handleAssistant(stopped);
  }

  function retry(message: ChatMessage, conversation: Conversation) {
    const index = conversation.messages.findIndex((item) => item.id === message.id);
    const previous = conversation.messages[index - 1];
    if (previous?.role !== "user") return;
    ask(previous.content, previous.attachments, message.id);
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
              onClick={() => {
                setHistoryState("loading");
                window.setTimeout(() => {
                  const first = createConversation();
                  setConversations([first]);
                  setActiveId(first.id);
                  setHistoryState("ready");
                }, 400);
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
    />
  );

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-1 gap-3 px-3 pb-3 sm:gap-4 sm:px-4 sm:pb-4">
      <Surface
        as="aside"
        elevation="raised"
        radius="card"
        className="hidden w-60 shrink-0 md:flex md:flex-col lg:w-72"
      >
        {history}
      </Surface>

      <Surface
        as="section"
        elevation="raised"
        radius="card"
        className="flex min-w-0 flex-1 flex-col"
      >
        <div className="flex items-center gap-2 px-3 py-3 sm:px-5 sm:py-4 md:hidden">
          <Button
            variant="secondary"
            size="icon"
            aria-label={copy.chat.historyOpen}
            onClick={() => setHistoryOpen(true)}
          >
            <IconHistory />
          </Button>
          <h1 className="min-w-0 flex-1 truncate font-semibold">{copy.chat.pageTitle}</h1>
          <Button variant="secondary" onClick={startConversation}>
            <span className="sm:hidden">{copy.chat.newConversationShort}</span>
            <span className="hidden sm:inline">{copy.chat.newConversation}</span>
          </Button>
        </div>

        {!online ? (
          <Surface
            elevation="gold"
            radius="pill"
            className="mx-3 mt-2 bg-accent-subtle px-4 py-2 text-sm font-medium text-accent-hover sm:mx-4"
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
            <ol className="mx-auto flex max-w-3xl flex-col gap-4">
              {active?.messages.map((message) => (
                <li key={message.id}>
                  {message.role === "user" ? (
                    <Surface
                      as="article"
                      elevation="bubble"
                      radius="bubble"
                      className="ml-auto w-fit max-w-[92%] bg-brand px-4 py-3 text-inverse sm:max-w-[85%] sm:px-5"
                    >
                      {message.attachments?.length ? (
                        <ul className="mb-2 flex flex-wrap gap-2">
                          {message.attachments.map((item) => (
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
                      ) : null}
                      <p className="break-words">{message.content}</p>
                    </Surface>
                  ) : (
                    <AssistantTurn
                      message={message}
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
          lastAssistant={lastAssistant}
          onSubmitQuestion={(question, attachments) => ask(question, attachments)}
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
    </div>
  );
}

function ConversationHistory({
  conversations,
  activeId,
  onSelect,
  onCreate,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-4">
        <Button className="w-full" onClick={onCreate}>
          {copy.chat.newConversation}
        </Button>
      </div>
      <nav aria-label={copy.chat.sidebarLabel} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {conversations.length === 0 ? (
          <p className="px-2 py-3 text-sm text-content-muted">
            {copy.chat.noConversations}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {conversations.map((item) => (
              <li key={item.id}>
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
              </li>
            ))}
          </ul>
        )}
      </nav>
    </div>
  );
}

function AssistantTurn({
  message,
  onRetry,
  onReformulate,
}: {
  message: Extract<ChatMessage, { role: "assistant" }>;
  onRetry: () => void;
  onReformulate: () => void;
}) {
  if (message.status === "pending") {
    return (
      <Surface
        as="article"
        elevation="soft"
        radius="bubble"
        className="max-w-[92%] px-4 py-3 text-content-muted sm:max-w-[85%] sm:px-5"
        aria-busy="true"
        aria-live="polite"
      >
        {copy.chat.pendingAnnouncement}
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
          <Button variant="secondary" onClick={onReformulate}>
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
          <Button variant="secondary" onClick={onRetry}>
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
          <Button variant="secondary" onClick={onRetry}>
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
          <Button variant="secondary" onClick={onRetry}>
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
          <Button variant="secondary" onClick={onRetry}>
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
      className="max-w-[92%] px-4 py-3 sm:max-w-[85%] sm:px-5"
    >
      <p className="break-words">{message.content}</p>
      <section className="mt-4 pt-3">
        <h3 className="text-sm font-semibold">{copy.chat.sourcesHeading}</h3>
        <ul className="mt-2 flex flex-col gap-2">
          {message.sources.map((source) => (
            <li key={`${source.documentId}-${source.extrait}`}>
              <Surface elevation="pressed" radius="surface" className="px-3 py-2">
                <p className="text-sm font-semibold">{source.titre}</p>
                <p className="mt-1 text-sm text-content-muted">
                  {copy.chat.extractLabel} : {source.extrait}
                </p>
                {source.url_source ? (
                  <p className="mt-1 text-sm">
                    <a
                      href={source.url_source}
                      className="neo-link break-all"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.url_source}
                    </a>
                  </p>
                ) : null}
              </Surface>
            </li>
          ))}
        </ul>
      </section>
    </Surface>
  );
}
