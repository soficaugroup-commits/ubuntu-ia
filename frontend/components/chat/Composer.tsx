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
import { Tooltip } from "@/components/ui/Tooltip";
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
  CHAT_ANALYZE_MAX_BYTES,
  COMPOSER_FILE_ACCEPT,
  COMPOSER_IMAGE_ACCEPT,
  COMPOSER_MAX_BYTES,
  COMPOSER_MAX_FILES,
  fileToBase64,
  formatFileSize,
  isAllowedComposerFile,
  isImageFile,
} from "@/lib/composer-files";
import { interpolate } from "@/lib/format";
import {
  canUseRealtimeVoice,
  RealtimeVoiceSession,
} from "@/lib/realtime-voice";
import {
  getSpeechRecognitionCtor,
  transcriptFromSpeechEvent,
  type SpeechRecognitionLike,
} from "@/lib/speech";
import { recentVoiceTurns, saveVoiceTurn } from "@/lib/voice-api";
import type { ChatAttachment, ChatMessage, ChatTools } from "@/lib/types";

export type ComposerHandle = {
  focus: () => void;
  reset: () => void;
  handleAssistant: (message: Extract<ChatMessage, { role: "assistant" }>) => void;
};

type VoicePhase =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "unsupported"
  | "denied"
  | "error";

type Props = {
  online: boolean;
  sending: boolean;
  conversationId: string;
  messages: ChatMessage[];
  onSubmitQuestion: (question: string, attachments: ChatAttachment[], tools?: ChatTools) => void;
  onVoiceTurn: (user: string, assistant: string) => void;
  onStop: () => void;
};

type ToolItem = {
  id: string;
  label: string;
  tip: string;
  icon: typeof IconPlus;
  action: "files" | "photos" | "camera" | "documents" | "dictate" | "web" | "image" | "research" | "canvas" | "file";
  active?: boolean;
};

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { online, sending, conversationId, messages, onSubmitQuestion, onVoiceTurn, onStop },
  ref,
) {
  const labelId = useId();
  const hintId = useId();
  const errorId = useId();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(new Map<string, File>());
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const realtimeRef = useRef<RealtimeVoiceSession | null>(null);
  const voiceSessionRef = useRef(false);
  const dictateIntentRef = useRef(false);
  const baselineRef = useRef("");
  const draftRef = useRef("");
  const voiceDraftRef = useRef("");
  const sendingRef = useRef(false);
  const onlineRef = useRef(online);
  const attachmentsRef = useRef<ChatAttachment[]>([]);
  const onSubmitQuestionRef = useRef(onSubmitQuestion);
  const submitRef = useRef<(question: string, files: ChatAttachment[]) => void>(() => {});
  const restartTimerRef = useRef<number | null>(null);
  const listenStartedAtRef = useRef(0);

  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [validation, setValidation] = useState<string | undefined>();
  const [fileError, setFileError] = useState<string | undefined>();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [imageOn, setImageOn] = useState(false);
  const [canvasOn, setCanvasOn] = useState(false);
  const [fileOn, setFileOn] = useState(false);
  const [toolsHint, setToolsHint] = useState<string | undefined>();
  const [dictating, setDictating] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("idle");
  const [voiceDraft, setVoiceDraft] = useState("");
  const [voiceAnswer, setVoiceAnswer] = useState("");
  const [voiceError, setVoiceError] = useState<string | undefined>();
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

  const conversationIdRef = useRef(conversationId);
  const messagesRef = useRef(messages);
  const onVoiceTurnRef = useRef(onVoiceTurn);

  useEffect(() => {
    draftRef.current = draft;
    voiceDraftRef.current = voiceDraft;
    sendingRef.current = sending;
    onlineRef.current = online;
    attachmentsRef.current = attachments;
    onSubmitQuestionRef.current = onSubmitQuestion;
    conversationIdRef.current = conversationId;
    messagesRef.current = messages;
    onVoiceTurnRef.current = onVoiceTurn;
  }, [
    draft,
    voiceDraft,
    sending,
    online,
    attachments,
    onSubmitQuestion,
    conversationId,
    messages,
    onVoiceTurn,
  ]);

  function clearRestartTimer() {
    if (restartTimerRef.current == null) return;
    window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
  }

  function stopRecognition() {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.stop();
    } catch {
      recognition.abort();
    }
  }

  function stopRealtime() {
    realtimeRef.current?.close();
    realtimeRef.current = null;
  }

  function scheduleListen(delay = 280) {
    clearRestartTimer();
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      if (!dictateIntentRef.current) return;
      startDictation();
    }, delay);
  }

  function startDictation() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      dictateIntentRef.current = false;
      setFileError(copy.chat.voiceUnsupportedBody);
      setDictating(false);
      return;
    }
    clearRestartTimer();
    stopRecognition();
    const recognition = new Ctor();
    recognition.lang = "fr-FR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    baselineRef.current = draftRef.current;
    dictateIntentRef.current = true;
    setDictating(true);
    recognition.onstart = () => {
      listenStartedAtRef.current = Date.now();
    };
    recognition.onresult = (event) => {
      const spoken = transcriptFromSpeechEvent(event);
      const next = [baselineRef.current, spoken].filter(Boolean).join(" ");
      draftRef.current = next;
      setDraft(next);
      setValidation(undefined);
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        dictateIntentRef.current = false;
        setDictating(false);
        setFileError(copy.chat.voiceDeniedBody);
        return;
      }
      dictateIntentRef.current = false;
      setDictating(false);
      setFileError(copy.chat.voiceErrorBody);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (!dictateIntentRef.current) {
        setDictating(false);
        return;
      }
      const elapsed = Date.now() - listenStartedAtRef.current;
      scheduleListen(elapsed < 500 ? 800 : 220);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      if (dictateIntentRef.current) scheduleListen(800);
    }
  }

  useImperativeHandle(ref, () => ({
    focus() {
      areaRef.current?.focus();
    },
    reset() {
      dictateIntentRef.current = false;
      clearRestartTimer();
      stopRecognition();
      stopRealtime();
      voiceSessionRef.current = false;
      setDraft("");
      draftRef.current = "";
      setAttachments((current) => {
        current.forEach((item) => {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        });
        filesRef.current.clear();
        return [];
      });
      setValidation(undefined);
      setFileError(undefined);
      setToolsHint(undefined);
      setImageOn(false);
      setCanvasOn(false);
      setFileOn(false);
      setVoiceOpen(false);
      setVoiceDraft("");
      setVoiceAnswer("");
      setVoiceError(undefined);
      voiceDraftRef.current = "";
      setVoicePhase("idle");
    },
    handleAssistant() {
      /* le mode vocal Realtime n'attend plus la réponse texte */
    },
  }));

  useEffect(() => {
    return () => {
      dictateIntentRef.current = false;
      voiceSessionRef.current = false;
      clearRestartTimer();
      stopRecognition();
      stopRealtime();
    };
  }, []);

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
        const id = crypto.randomUUID();
        filesRef.current.set(id, file);
        next.push({
          id,
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
      filesRef.current.delete(id);
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
    if (sendingRef.current || !onlineRef.current) {
      return;
    }
    const snapshot = files.map((item) => ({ ...item }));
    const imageRequested = imageOn;
    const canvasRequested = canvasOn;
    const fileRequested = fileOn;
    setValidation(undefined);
    setFileError(undefined);
    setToolsHint(undefined);
    setDraft("");
    draftRef.current = "";
    setAttachments([]);
    setImageOn(false);
    setCanvasOn(false);
    setFileOn(false);
    dictateIntentRef.current = false;
    clearRestartTimer();
    setDictating(false);
    stopRecognition();
    void (async () => {
      const payload = await withFileBytes(snapshot);
      snapshot.forEach((item) => filesRef.current.delete(item.id));
      onSubmitQuestionRef.current(text, payload, {
        image: imageRequested,
        canvas: canvasRequested,
        file: fileRequested,
      });
    })();
  }

  useEffect(() => {
    submitRef.current = submit;
  });

  async function withFileBytes(items: ChatAttachment[]): Promise<ChatAttachment[]> {
    return Promise.all(
      items.map(async (item) => {
        const file = filesRef.current.get(item.id);
        const limit = item.kind === "image" ? COMPOSER_MAX_BYTES : CHAT_ANALYZE_MAX_BYTES;
        if (!file || file.size > limit) return item;
        try {
          return { ...item, contentBase64: await fileToBase64(file) };
        } catch {
          return item;
        }
      }),
    );
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
    dictateIntentRef.current = false;
    setDictating(false);
    stopRecognition();
    stopRealtime();
    voiceSessionRef.current = true;
    setVoiceOpen(true);
    setVoiceDraft("");
    setVoiceAnswer("");
    setVoiceError(undefined);
    voiceDraftRef.current = "";
    if (!canUseRealtimeVoice()) {
      setVoicePhase("unsupported");
      return;
    }
    void connectVoice();
  }

  async function connectVoice() {
    if (!voiceSessionRef.current) return;
    setVoicePhase("connecting");
    setVoiceDraft("");
    setVoiceAnswer("");
    setVoiceError(undefined);
    stopRealtime();
    const session = new RealtimeVoiceSession({
      onPhase(phase) {
        if (!voiceSessionRef.current) return;
        setVoicePhase(phase);
      },
      onUserTranscript(text) {
        if (!voiceSessionRef.current) return;
        voiceDraftRef.current = text;
        setVoiceDraft(text);
      },
      onAssistantTranscript(text) {
        if (!voiceSessionRef.current) return;
        setVoiceAnswer(text);
      },
      onTurn(user, assistant) {
        onVoiceTurnRef.current(user, assistant);
        void saveVoiceTurn(conversationIdRef.current, user, assistant);
      },
      onError(message) {
        if (!voiceSessionRef.current) return;
        setVoiceError(message);
        setVoicePhase("error");
      },
    });
    realtimeRef.current = session;
    try {
      await session.connect(recentVoiceTurns(messagesRef.current));
    } catch (error) {
      if (!voiceSessionRef.current || realtimeRef.current !== session) return;
      session.close();
      realtimeRef.current = null;
      const denied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "PermissionDeniedError");
      if (denied) {
        setVoicePhase("denied");
        return;
      }
      setVoiceError(error instanceof Error ? error.message : copy.chat.voiceErrorBody);
      setVoicePhase("error");
    }
  }

  function closeVoice() {
    stopRealtime();
    voiceSessionRef.current = false;
    setVoiceOpen(false);
    setVoicePhase("idle");
    setVoiceDraft("");
    setVoiceAnswer("");
    setVoiceError(undefined);
    voiceDraftRef.current = "";
  }

  const tools: ToolItem[] = [
    { id: "files", label: copy.chat.attachFile, tip: copy.chat.tipAttachFile, icon: IconPaperclip, action: "files" },
    { id: "photos", label: copy.chat.attachPhoto, tip: copy.chat.tipAttachPhoto, icon: IconImage, action: "photos" },
    { id: "camera", label: copy.chat.attachCamera, tip: copy.chat.tipAttachCamera, icon: IconCamera, action: "camera" },
    {
      id: "documents",
      label: copy.chat.toolDocuments,
      tip: copy.chat.tipToolDocuments,
      icon: IconSearch,
      action: "documents",
      active: true,
    },
    { id: "dictate", label: copy.chat.dictate, tip: copy.chat.tipToolDictate, icon: IconMic, action: "dictate" },
    { id: "web", label: copy.chat.toolWeb, tip: copy.chat.tipToolWeb, icon: IconGlobe, action: "web", active: true },
    { id: "image", label: copy.chat.toolImage, tip: copy.chat.tipToolImage, icon: IconSparkle, action: "image", active: imageOn },
    { id: "research", label: copy.chat.toolResearch, tip: copy.chat.tipToolResearch, icon: IconResearch, action: "research", active: true },
    { id: "canvas", label: copy.chat.toolCanvas, tip: copy.chat.tipToolCanvas, icon: IconCanvas, action: "canvas", active: canvasOn },
    { id: "file", label: copy.chat.toolFile, tip: copy.chat.tipToolFile, icon: IconFile, action: "file", active: fileOn },
  ];

  function disarmImage() {
    setImageOn(false);
    setToolsHint(copy.chat.toolImageOff);
  }

  function disarmCanvas() {
    setCanvasOn(false);
    setToolsHint(copy.chat.toolCanvasOff);
  }

  function disarmFile() {
    setFileOn(false);
    setToolsHint(copy.chat.toolFileOff);
  }

  function runTool(action: ToolItem["action"]) {
    setToolsOpen(false);
    if (action === "files") fileRef.current?.click();
    else if (action === "photos") photoRef.current?.click();
    else if (action === "camera") cameraRef.current?.click();
    else if (action === "dictate") toggleDictate();
    else if (action === "documents") setToolsHint(copy.chat.toolDocumentsHint);
    else if (action === "web") setToolsHint(copy.chat.toolWebHint);
    else if (action === "research") setToolsHint(copy.chat.toolResearchHint);
    else if (action === "image") {
      setImageOn((current) => {
        const next = !current;
        setToolsHint(next ? copy.chat.toolImageOn : copy.chat.toolImageOff);
        return next;
      });
    } else if (action === "canvas") {
      setCanvasOn((current) => {
        const next = !current;
        setToolsHint(next ? copy.chat.toolCanvasOn : copy.chat.toolCanvasOff);
        return next;
      });
    } else if (action === "file") {
      setFileOn((current) => {
        const next = !current;
        setToolsHint(next ? copy.chat.toolFileOn : copy.chat.toolFileOff);
        return next;
      });
    }
  }

  function toggleDictate() {
    if (dictating || dictateIntentRef.current) {
      dictateIntentRef.current = false;
      clearRestartTimer();
      stopRecognition();
      setDictating(false);
      return;
    }
    startDictation();
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
      className="shrink-0 px-3 pb-3 pt-2 sm:px-5 sm:pb-4"
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
                    tooltip={interpolate(copy.chat.tipRemoveAttachment, { name: item.name })}
                    onClick={() => removeAttachment(item.id)}
                  >
                    <IconClose />
                  </Button>
                </Surface>
              </li>
            ))}
          </ul>
        ) : null}
        {imageOn || canvasOn || fileOn ? (
          <div className="flex flex-wrap gap-2">
            {imageOn ? (
              <ArmedChip
                label={copy.chat.toolImageArmed}
                dismissLabel={copy.chat.toolImageDisarm}
                tooltip={copy.chat.tipDisarmImage}
                onDismiss={disarmImage}
              />
            ) : null}
            {canvasOn ? (
              <ArmedChip
                label={copy.chat.toolCanvasArmed}
                dismissLabel={copy.chat.toolCanvasDisarm}
                tooltip={copy.chat.tipDisarmCanvas}
                onDismiss={disarmCanvas}
              />
            ) : null}
            {fileOn ? (
              <ArmedChip
                label={copy.chat.toolFileArmed}
                dismissLabel={copy.chat.toolFileDisarm}
                tooltip={copy.chat.tipDisarmFile}
                onDismiss={disarmFile}
              />
            ) : null}
          </div>
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
            draftRef.current = event.target.value;
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
            tooltip={copy.chat.tipAttachMenu}
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
              tooltip={dictating ? copy.chat.tipDictateStop : copy.chat.tipDictate}
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
                tooltip={copy.chat.tipStop}
                onClick={onStop}
              >
                <IconStop />
              </Button>
            ) : canSend ? (
              <Button
                type="submit"
                size="icon"
                aria-label={copy.chat.send}
                tooltip={copy.chat.tipSend}
              >
                <IconSend />
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label={copy.chat.voiceMode}
                tooltip={copy.chat.tipVoiceMode}
                disabled={!online || !conversationId}
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
        {toolsHint ? (
          <p className="text-sm text-content-muted" role="status">
            {toolsHint}
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
                <Tooltip label={tool.tip} className="w-full">
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
                  <span className="min-w-0 flex-1">
                    <span className="block">{tool.label}</span>
                    <span className="mt-0.5 block text-xs font-medium text-content-muted">
                      {tool.tip}
                    </span>
                  </span>
                  {tool.active ? (
                    <IconCheck className="size-5 text-content-muted" />
                  ) : null}
                </button>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </Sheet>

      <Dialog
        open={voiceOpen}
        title={copy.chat.voiceMode}
        onClose={closeVoice}
      >
        <VoicePanel
          phase={voicePhase}
          draft={voiceDraft}
          answer={voiceAnswer}
          error={voiceError}
          onRetry={() => void connectVoice()}
          onClose={closeVoice}
        />
      </Dialog>
    </form>
  );
});

Composer.displayName = "Composer";

function ArmedChip({
  label,
  dismissLabel,
  tooltip,
  onDismiss,
}: {
  label: string;
  dismissLabel: string;
  tooltip: string;
  onDismiss: () => void;
}) {
  return (
    <Surface elevation="gold" radius="pill" className="flex w-fit items-center gap-1 py-1 pl-4 pr-1 text-content">
      <span className="text-sm font-medium">{label}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 min-h-8 min-w-8"
        aria-label={dismissLabel}
        tooltip={tooltip}
        onClick={onDismiss}
      >
        <IconClose />
      </Button>
    </Surface>
  );
}

function VoicePanel({
  phase,
  draft,
  answer,
  error,
  onRetry,
  onClose,
}: {
  phase: VoicePhase;
  draft: string;
  answer: string;
  error?: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  const status =
    phase === "unsupported"
      ? { title: copy.chat.voiceUnsupportedTitle, body: copy.chat.voiceUnsupportedBody }
      : phase === "denied"
        ? { title: copy.chat.voiceDeniedTitle, body: copy.chat.voiceDeniedBody }
        : phase === "error"
          ? { title: copy.chat.voiceErrorTitle, body: error || copy.chat.voiceErrorBody }
          : phase === "connecting"
            ? { title: copy.chat.voiceConnecting, body: copy.chat.voiceConnectingHint }
            : phase === "thinking"
              ? { title: copy.chat.voiceThinking, body: draft }
              : phase === "speaking"
                ? { title: copy.chat.voiceSpeaking, body: answer }
                : { title: copy.chat.voiceListening, body: draft || copy.chat.voiceListeningHint };

  return (
    <div className="flex flex-col gap-4">
      <Surface
        elevation={phase === "speaking" ? "raised" : "pressed"}
        radius="surface"
        className="px-4 py-5 text-center"
        role="status"
      >
        <p className="flex items-center justify-center gap-2 font-semibold">
          {phase === "listening" || phase === "speaking" || phase === "connecting" ? (
            <IconWave />
          ) : null}
          {status.title}
        </p>
        {status.body ? <p className="mt-2 text-sm text-content-muted">{status.body}</p> : null}
        {phase === "speaking" && draft ? (
          <p className="mt-3 text-xs text-content-muted">{draft}</p>
        ) : null}
      </Surface>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" tooltip={copy.chat.tipVoiceClose} onClick={onClose}>
          {copy.chat.voiceModeClose}
        </Button>
        {phase === "idle" || phase === "error" || phase === "denied" ? (
          <Button type="button" tooltip={copy.chat.tipVoiceRetry} onClick={onRetry}>
            {copy.chat.voiceRetry}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
