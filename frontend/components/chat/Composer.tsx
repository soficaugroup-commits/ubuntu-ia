"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Sheet } from "@/components/ui/Sheet";
import { Surface } from "@/components/ui/Surface";
import {
  IconCamera,
  IconCanvas,
  IconCheck,
  IconClose,
  IconFile,
  IconGlobe,
  IconImage,
  IconMic,
  IconPaperclip,
  IconPlus,
  IconResearch,
  IconSearch,
  IconSend,
  IconSparkle,
  IconStop,
  IconWave,
} from "@/components/ui/icons";
import { copy } from "@/content/fr";
import {
  COMPOSER_FILE_ACCEPT,
  COMPOSER_IMAGE_ACCEPT,
  COMPOSER_MAX_BYTES,
  COMPOSER_MAX_FILES,
  formatFileSize,
  isAllowedComposerFile,
  isImageFile,
} from "@/lib/composer-files";
import { interpolate } from "@/lib/format";
import {
  getSpeechRecognitionCtor,
  speakText,
  stopSpeaking,
  type SpeechRecognitionLike,
} from "@/lib/speech";
import type { ChatAttachment, ChatMessage } from "@/lib/types";

export type ComposerHandle = {
  focus: () => void;
  reset: () => void;
  handleAssistant: (message: Extract<ChatMessage, { role: "assistant" }>) => void;
};

type VoicePhase =
  | "idle"
  | "listening"
  | "processing"
  | "speaking"
  | "unsupported"
  | "denied"
  | "error";

type UnavailableTool = "web" | "image" | "research" | "canvas";

type Props = {
  online: boolean;
  sending: boolean;
  lastAssistant: Extract<ChatMessage, { role: "assistant" }> | null;
  onSubmitQuestion: (question: string, attachments: ChatAttachment[]) => void;
  onStop: () => void;
};

type ToolItem = {
  id: string;
  label: string;
  icon: typeof IconPlus;
  action: "files" | "photos" | "camera" | "documents" | "dictate" | UnavailableTool;
  active?: boolean;
};

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { online, sending, lastAssistant, onSubmitQuestion, onStop },
  ref,
) {
  const labelId = useId();
  const hintId = useId();
  const errorId = useId();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const spokenIdRef = useRef<string | null>(null);
  const voiceSessionRef = useRef(false);
  const baselineRef = useRef("");

  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [validation, setValidation] = useState<string | undefined>();
  const [fileError, setFileError] = useState<string | undefined>();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [unavailable, setUnavailable] = useState<UnavailableTool | null>(null);
  const [dictating, setDictating] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("idle");
  const [voiceDraft, setVoiceDraft] = useState("");
  const [dragging, setDragging] = useState(false);

  const canSend = online && !sending && (Boolean(draft.trim()) || attachments.length > 0);
  const describedBy = [hintId, validation ? errorId : null].filter(Boolean).join(" ");

  const resizeArea = useCallback(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    resizeArea();
  }, [draft, resizeArea]);

  useImperativeHandle(ref, () => ({
    focus() {
      areaRef.current?.focus();
    },
    reset() {
      stopRecognition();
      stopSpeaking();
      setDraft("");
      setAttachments((current) => {
        current.forEach((item) => {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        });
        return [];
      });
      setValidation(undefined);
      setFileError(undefined);
      setVoiceOpen(false);
      setVoiceDraft("");
      setVoicePhase("idle");
      voiceSessionRef.current = false;
    },
    handleAssistant(message) {
      if (!voiceSessionRef.current) return;
      if (message.status === "pending") {
        setVoicePhase("processing");
        return;
      }
      if (message.status === "answered" && spokenIdRef.current !== message.id) {
        spokenIdRef.current = message.id;
        setVoicePhase("speaking");
        void speakText(message.content).then(() => {
          if (!voiceSessionRef.current) return;
          startListening("voice");
        });
        return;
      }
      if (
        message.status === "error" ||
        message.status === "timeout" ||
        message.status === "offline" ||
        message.status === "no_source" ||
        message.status === "stopped"
      ) {
        setVoicePhase("error");
      }
    },
  }));

  useEffect(() => {
    return () => {
      stopRecognition();
      stopSpeaking();
    };
  }, []);

  function stopRecognition() {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    setDictating(false);
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.stop();
    } catch {
      recognition.abort();
    }
  }

  function startListening(mode: "dictate" | "voice") {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      if (mode === "voice") {
        setVoiceOpen(true);
        setVoicePhase("unsupported");
      } else {
        setFileError(copy.chat.voiceUnsupportedBody);
      }
      return;
    }
    stopRecognition();
    stopSpeaking();
    const recognition = new Ctor();
    recognition.lang = "fr-FR";
    recognition.continuous = mode === "dictate";
    recognition.interimResults = true;
    baselineRef.current = mode === "dictate" ? draft : "";
    if (mode === "voice") {
      setVoiceDraft("");
      setVoicePhase("listening");
    } else {
      setDictating(true);
    }
    recognition.onresult = (event) => {
      let finalText = "";
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      const spoken = `${finalText} ${interim}`.replace(/\s+/g, " ").trim();
      if (mode === "dictate") {
        const next = [baselineRef.current, spoken].filter(Boolean).join(" ");
        setDraft(next);
        setValidation(undefined);
      } else {
        setVoiceDraft(spoken);
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        if (mode === "voice") setVoicePhase("denied");
        else setFileError(copy.chat.voiceDeniedBody);
      } else if (event.error !== "aborted" && event.error !== "no-speech") {
        if (mode === "voice") setVoicePhase("error");
        else setFileError(copy.chat.voiceErrorBody);
      }
      setDictating(false);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setDictating(false);
      if (mode === "voice" && voiceSessionRef.current) {
        setVoiceDraft((current) => {
          const question = current.trim();
          if (question && !sending) {
            submit(question, attachments);
          } else if (voiceSessionRef.current && voicePhase === "listening") {
            setVoicePhase("idle");
          }
          return current;
        });
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      if (mode === "voice") setVoicePhase("error");
    }
  }

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    if (!incoming.length) return;
    setFileError(undefined);
    setAttachments((current) => {
      const next = [...current];
      let error: string | undefined;
      for (const file of incoming) {
        if (next.length >= COMPOSER_MAX_FILES) {
          error = copy.chat.attachmentLimit;
          break;
        }
        if (file.size > COMPOSER_MAX_BYTES) {
          error = interpolate(copy.chat.attachmentTooBig, { name: file.name });
          continue;
        }
        if (!isAllowedComposerFile(file)) {
          error = interpolate(copy.chat.attachmentType, { name: file.name });
          continue;
        }
        const kind = isImageFile(file) ? "image" : "file";
        next.push({
          id: crypto.randomUUID(),
          name: file.name,
          mime: file.type || "application/octet-stream",
          size: file.size,
          kind,
          previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
        });
      }
      if (error) setFileError(error);
      return next;
    });
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  function submit(question: string, files: ChatAttachment[]) {
    const text = question.trim() || (files.length ? copy.chat.attachmentOnlyPrompt : "");
    if (!text) {
      setValidation(copy.chat.validationEmpty);
      areaRef.current?.focus();
      return;
    }
    if (sending || !online) return;
    setValidation(undefined);
    setFileError(undefined);
    setDraft("");
    setAttachments([]);
    setDictating(false);
    stopRecognition();
    onSubmitQuestion(text, files);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit(draft, attachments);
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = event.clipboardData?.files;
    if (files?.length) {
      event.preventDefault();
      addFiles(files);
    }
  }

  function onDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  }

  function openVoice() {
    const Ctor = getSpeechRecognitionCtor();
    voiceSessionRef.current = true;
    setVoiceOpen(true);
    setVoiceDraft("");
    spokenIdRef.current = lastAssistant?.id ?? null;
    if (!Ctor) {
      setVoicePhase("unsupported");
      return;
    }
    startListening("voice");
  }

  function closeVoice() {
    voiceSessionRef.current = false;
    stopRecognition();
    stopSpeaking();
    setVoiceOpen(false);
    setVoicePhase("idle");
    setVoiceDraft("");
  }

  const tools: ToolItem[] = [
    { id: "files", label: copy.chat.attachFile, icon: IconPaperclip, action: "files" },
    { id: "photos", label: copy.chat.attachPhoto, icon: IconImage, action: "photos" },
    { id: "camera", label: copy.chat.attachCamera, icon: IconCamera, action: "camera" },
    {
      id: "documents",
      label: copy.chat.toolDocuments,
      icon: IconSearch,
      action: "documents",
      active: true,
    },
    { id: "dictate", label: copy.chat.dictate, icon: IconMic, action: "dictate" },
    { id: "web", label: copy.chat.toolWeb, icon: IconGlobe, action: "web" },
    { id: "image", label: copy.chat.toolImage, icon: IconSparkle, action: "image" },
    { id: "research", label: copy.chat.toolResearch, icon: IconResearch, action: "research" },
    { id: "canvas", label: copy.chat.toolCanvas, icon: IconCanvas, action: "canvas" },
  ];

  function runTool(action: ToolItem["action"]) {
    setToolsOpen(false);
    if (action === "files") fileRef.current?.click();
    else if (action === "photos") photoRef.current?.click();
    else if (action === "camera") cameraRef.current?.click();
    else if (action === "dictate") toggleDictate();
    else if (action === "documents") setFileError(copy.chat.toolDocumentsHint);
    else setUnavailable(action);
  }

  function toggleDictate() {
    if (dictating) {
      stopRecognition();
      return;
    }
    startListening("dictate");
  }

  return (
    <form
      onSubmit={onSubmit}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className="px-3 pb-3 pt-2 sm:px-5 sm:pb-4"
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={COMPOSER_FILE_ACCEPT}
        className="sr-only"
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={photoRef}
        type="file"
        multiple
        accept={COMPOSER_IMAGE_ACCEPT}
        className="sr-only"
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <Surface
        elevation={dragging ? "pressed" : "soft"}
        radius="card"
        className="mx-auto flex max-w-3xl flex-col gap-3 p-3 sm:p-4"
      >
        {attachments.length ? (
          <ul
            className="flex flex-wrap gap-2"
            aria-label={copy.chat.attachmentsLabel}
          >
            {attachments.map((item) => (
              <li key={item.id}>
                <Surface
                  elevation="pressed"
                  radius="surface"
                  className="flex max-w-[16rem] items-center gap-2 px-2 py-1.5"
                >
                  {item.kind === "image" && item.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.previewUrl}
                      alt=""
                      className="size-10 rounded-[14px] object-cover"
                    />
                  ) : (
                    <IconFile />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{item.name}</span>
                    <span className="block text-xs text-content-muted">
                      {formatFileSize(item.size)}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 min-h-9 min-w-9"
                    aria-label={interpolate(copy.chat.removeAttachment, { name: item.name })}
                    onClick={() => removeAttachment(item.id)}
                  >
                    <IconClose />
                  </Button>
                </Surface>
              </li>
            ))}
          </ul>
        ) : null}

        <label htmlFor={labelId} className="sr-only">
          {copy.chat.composerLabel}
        </label>
        <textarea
          id={labelId}
          ref={areaRef}
          rows={1}
          value={draft}
          placeholder={
            dragging ? copy.chat.composerDrop : copy.chat.composerPlaceholder
          }
          aria-invalid={Boolean(validation)}
          aria-describedby={describedBy}
          onChange={(event) => {
            setDraft(event.target.value);
            if (validation) setValidation(undefined);
          }}
          onKeyDown={onComposerKey}
          onPaste={onPaste}
          className="max-h-52 min-h-12 w-full resize-none border-0 bg-transparent px-2 py-2 text-content placeholder:text-content-muted focus:outline-none"
        />

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label={copy.chat.attachMenu}
            aria-expanded={toolsOpen}
            aria-haspopup="dialog"
            onClick={() => setToolsOpen(true)}
          >
            <IconPlus />
          </Button>
          <p id={hintId} className="hidden min-w-0 flex-1 text-xs text-content-muted sm:block">
            {dictating ? copy.chat.dictateListening : copy.chat.composerHint}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant={dictating ? "danger" : "ghost"}
              size="icon"
              aria-pressed={dictating}
              aria-label={dictating ? copy.chat.dictateStop : copy.chat.dictate}
              disabled={!online}
              onClick={toggleDictate}
            >
              <IconMic />
            </Button>
            {sending ? (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label={copy.chat.stop}
                onClick={onStop}
              >
                <IconStop />
              </Button>
            ) : canSend ? (
              <Button type="submit" size="icon" aria-label={copy.chat.send}>
                <IconSend />
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label={copy.chat.voiceMode}
                disabled={!online}
                onClick={openVoice}
              >
                <IconWave />
              </Button>
            )}
          </div>
        </div>

        {validation ? (
          <p id={errorId} className="text-sm font-medium text-accent-hover" role="alert">
            {validation}
          </p>
        ) : null}
        {fileError ? (
          <p className="text-sm font-medium text-accent-hover" role="status">
            {fileError}
          </p>
        ) : null}
        <p className="text-xs text-content-muted sm:hidden" aria-live="polite">
          {dictating ? copy.chat.dictateListening : null}
        </p>
      </Surface>

      <Sheet
        open={toolsOpen}
        title={copy.chat.attachMenuTitle}
        side="bottom"
        onClose={() => setToolsOpen(false)}
      >
        <ul className="flex flex-col gap-2 px-4 pb-6 pt-2">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <li key={tool.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (tool.action === "dictate") {
                      setToolsOpen(false);
                      toggleDictate();
                      return;
                    }
                    runTool(tool.action);
                  }}
                  className="flex w-full items-center gap-3 rounded-surface px-3 py-3 text-left text-sm font-semibold text-content neo-soft"
                >
                  <span className="flex size-11 items-center justify-center rounded-full neo-raised">
                    <Icon />
                  </span>
                  <span className="min-w-0 flex-1">{tool.label}</span>
                  {tool.active ? (
                    <IconCheck className="size-5 text-content-muted" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>

      <Dialog
        open={Boolean(unavailable)}
        title={copy.chat.toolUnavailableTitle}
        onClose={() => setUnavailable(null)}
      >
        <p className="text-content-muted">{copy.chat.toolUnavailableBody}</p>
        <div className="mt-5 flex justify-end">
          <Button type="button" onClick={() => setUnavailable(null)}>
            {copy.chat.toolUnavailableClose}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={voiceOpen}
        title={copy.chat.voiceMode}
        onClose={closeVoice}
      >
        <VoicePanel
          phase={voicePhase}
          draft={voiceDraft}
          sending={sending}
          onListen={() => startListening("voice")}
          onSend={() => {
            const question = voiceDraft.trim();
            if (!question) return;
            submit(question, attachments);
          }}
          onClose={closeVoice}
        />
      </Dialog>
    </form>
  );
});

Composer.displayName = "Composer";

function VoicePanel({
  phase,
  draft,
  sending,
  onListen,
  onSend,
  onClose,
}: {
  phase: VoicePhase;
  draft: string;
  sending: boolean;
  onListen: () => void;
  onSend: () => void;
  onClose: () => void;
}) {
  const status =
    phase === "unsupported"
      ? { title: copy.chat.voiceUnsupportedTitle, body: copy.chat.voiceUnsupportedBody }
      : phase === "denied"
        ? { title: copy.chat.voiceDeniedTitle, body: copy.chat.voiceDeniedBody }
        : phase === "error"
          ? { title: copy.chat.voiceErrorTitle, body: copy.chat.voiceErrorBody }
          : phase === "processing" || sending
            ? { title: copy.chat.voiceProcessing, body: draft }
            : phase === "speaking"
              ? { title: copy.chat.voiceSpeaking, body: draft }
              : { title: copy.chat.voiceListening, body: draft || copy.chat.dictateListening };

  return (
    <div className="flex flex-col gap-4">
      <Surface elevation="pressed" radius="surface" className="px-4 py-5 text-center" role="status">
        <p className="font-semibold">{status.title}</p>
        {status.body ? <p className="mt-2 text-sm text-content-muted">{status.body}</p> : null}
      </Surface>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          {copy.chat.voiceModeClose}
        </Button>
        {phase === "listening" && draft.trim() ? (
          <Button type="button" onClick={onSend}>
            {copy.chat.voiceSend}
          </Button>
        ) : null}
        {phase === "idle" || phase === "error" || phase === "denied" ? (
          <Button type="button" onClick={onListen}>
            {copy.chat.voiceRetry}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
