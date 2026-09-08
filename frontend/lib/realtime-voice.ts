import { streamVoiceTalk, type VoiceHistoryTurn } from "@/lib/voice-api";

export type RealtimeVoicePhase =
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking";

export type RealtimeVoiceHandlers = {
  onPhase: (phase: RealtimeVoicePhase) => void;
  onUserTranscript: (text: string) => void;
  onAssistantTranscript: (text: string) => void;
  onTurn: (user: string, assistant: string) => void;
  onError: (message: string) => void;
};

const TARGET_RATE = 24_000;
const SPEECH_RMS = 0.02;
const SILENCE_MS = 480;
const MIN_SPEECH_MS = 320;
const MAX_SPEECH_MS = 14_000;
const BARGE_MS = 180;

export function canUseRealtimeVoice(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

export class RealtimeVoiceSession {
  private readonly handlers: RealtimeVoiceHandlers;
  private closed = false;
  private history: VoiceHistoryTurn[] = [];
  private mic: MediaStream | null = null;
  private capture: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private player: PcmPlayer | null = null;
  private spoken = false;
  private speaking = false;
  private speechStarted = 0;
  private silentSince = 0;
  private bargeSince = 0;
  private pending: Float32Array[] = [];
  private turn: AbortController | null = null;
  private userLive = "";
  private assistantLive = "";

  constructor(handlers: RealtimeVoiceHandlers) {
    this.handlers = handlers;
  }

  async connect(recentMessages: VoiceHistoryTurn[]): Promise<void> {
    this.handlers.onPhase("connecting");
    this.history = recentMessages;
    const AudioCtx =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) throw new Error("Ce navigateur ne peut pas capturer l'audio.");

    const mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    if (this.closed) {
      mic.getTracks().forEach((track) => track.stop());
      return;
    }
    this.mic = mic;

    const capture = new AudioCtx();
    this.capture = capture;
    await capture.resume();
    const source = capture.createMediaStreamSource(mic);
    const processor = capture.createScriptProcessor(2048, 1, 1);
    this.processor = processor;
    processor.onaudioprocess = (event) => {
      this.onMic(event.inputBuffer.getChannelData(0), capture.sampleRate);
    };
    const mute = capture.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(capture.destination);

    this.player = new PcmPlayer();
    this.handlers.onPhase("listening");
  }

  close() {
    this.flushTurn();
    this.closed = true;
    this.turn?.abort();
    this.turn = null;
    this.processor?.disconnect();
    this.processor = null;
    void this.capture?.close();
    this.capture = null;
    this.mic?.getTracks().forEach((track) => track.stop());
    this.mic = null;
    this.player?.stop();
    this.player = null;
  }

  private onMic(frame: Float32Array, sampleRate: number) {
    if (this.closed) return;
    const rms = rootMeanSquare(frame);
    const now = performance.now();

    if (this.speaking) {
      if (rms >= SPEECH_RMS) {
        if (!this.bargeSince) this.bargeSince = now;
        if (now - this.bargeSince < BARGE_MS) return;
        this.bargeIn();
      } else {
        this.bargeSince = 0;
        return;
      }
    }

    if (rms >= SPEECH_RMS) {
      if (!this.spoken) this.speechStarted = now;
      this.spoken = true;
      this.silentSince = 0;
      this.pending.push(Float32Array.from(frame));
      if (now - this.speechStarted >= MAX_SPEECH_MS) this.commitUtterance(sampleRate);
      return;
    }

    if (!this.spoken) return;
    this.pending.push(Float32Array.from(frame));
    if (!this.silentSince) this.silentSince = now;
    if (now - this.speechStarted < MIN_SPEECH_MS) return;
    if (now - this.silentSince >= SILENCE_MS) this.commitUtterance(sampleRate);
  }

  private commitUtterance(sampleRate: number) {
    const chunks = this.pending;
    this.pending = [];
    this.spoken = false;
    this.silentSince = 0;
    this.speechStarted = 0;
    if (!chunks.length) return;
    const wav = encodeWav(downsample(concat(chunks), sampleRate, TARGET_RATE), TARGET_RATE);
    void this.ask(bytesToBase64(wav));
  }

  private async ask(audio: string) {
    if (this.closed || this.turn) return;
    const controller = new AbortController();
    this.turn = controller;
    this.userLive = "";
    this.assistantLive = "";
    this.handlers.onAssistantTranscript("");
    this.handlers.onPhase("thinking");
    this.speaking = true;
    try {
      const result = await streamVoiceTalk(audio, this.history, controller.signal, (event) => {
        if (this.closed || this.turn !== controller) return;
        if (event.type === "user_transcript") {
          this.userLive = event.content;
          this.handlers.onUserTranscript(event.content);
          return;
        }
        if (event.type === "transcript") {
          this.assistantLive += event.content;
          this.handlers.onAssistantTranscript(this.assistantLive);
          return;
        }
        if (event.type === "audio") {
          this.speaking = true;
          this.handlers.onPhase("speaking");
          this.player?.enqueue(event.data);
          return;
        }
        if (event.type === "thinking") {
          this.handlers.onPhase("thinking");
          return;
        }
        if (event.type === "erreur") {
          this.handlers.onError(event.message);
        }
      });
      if (this.closed || this.turn !== controller) return;
      if (!result.ok) {
        this.handlers.onError(result.error);
        return;
      }
      this.flushTurn();
    } catch (error) {
      if (controller.signal.aborted || this.closed) return;
      this.handlers.onError(
        error instanceof Error ? error.message : "La réponse vocale n'a pas pu être générée.",
      );
    } finally {
      if (this.turn === controller) this.turn = null;
      this.speaking = false;
      if (!this.closed) this.handlers.onPhase("listening");
    }
  }

  private bargeIn() {
    if (!this.speaking && !this.turn) return;
    this.turn?.abort();
    this.turn = null;
    this.player?.stop();
    this.flushTurn();
    this.speaking = false;
    this.spoken = false;
    this.pending = [];
    this.bargeSince = 0;
    this.assistantLive = "";
    this.handlers.onAssistantTranscript("");
    this.handlers.onPhase("listening");
  }

  private flushTurn() {
    const user = this.userLive.trim();
    const assistant = this.assistantLive.trim();
    if (!user && !assistant) return;
    if (user) {
      this.handlers.onTurn(user, assistant);
      const next: VoiceHistoryTurn[] = [...this.history, { role: "user", content: user }];
      if (assistant) next.push({ role: "assistant", content: assistant });
      this.history = next.slice(-8);
    }
    this.userLive = "";
    this.assistantLive = "";
  }
}

class PcmPlayer {
  private ctx: AudioContext | null = null;
  private next = 0;
  private sources: AudioBufferSourceNode[] = [];

  enqueue(base64: string) {
    const bytes = base64ToBytes(base64);
    if (!bytes.length) return;
    const pcm = stripWavHeader(bytes);
    const samples = pcm.byteLength >= 2 ? new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2)) : new Int16Array();
    if (!samples.length) return;
    const ctx = this.ensure();
    const buffer = ctx.createBuffer(1, samples.length, TARGET_RATE);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      channel[index] = samples[index] / 32768;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const start = Math.max(this.next, ctx.currentTime + 0.02);
    source.start(start);
    this.next = start + buffer.duration;
    this.sources.push(source);
    source.onended = () => {
      this.sources = this.sources.filter((item) => item !== source);
    };
  }

  stop() {
    this.sources.forEach((source) => {
      try {
        source.stop();
      } catch {
        /* déjà arrêté */
      }
    });
    this.sources = [];
    this.next = 0;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }

  private ensure(): AudioContext {
    if (this.ctx && this.ctx.state !== "closed") {
      void this.ctx.resume();
      return this.ctx;
    }
    const AudioCtx =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioCtx({ sampleRate: TARGET_RATE });
    this.next = 0;
    return this.ctx;
  }
}

function rootMeanSquare(frame: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < frame.length; index += 1) {
    sum += frame[index] * frame[index];
  }
  return Math.sqrt(sum / frame.length);
}

function concat(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const next = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    next.set(chunk, offset);
    offset += chunk.length;
  }
  return next;
}

function downsample(input: Float32Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) {
    const out = new Int16Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
      out[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return out;
  }
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const out = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[Math.floor(index * ratio)] ?? 0));
    out[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return out;
}

function encodeWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  bytes.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), 44);
  return bytes;
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function stripWavHeader(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12) return bytes;
  const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (header !== "RIFF") return bytes;
  const data = indexOfAscii(bytes, "data");
  return data >= 0 ? bytes.subarray(data + 8) : bytes.subarray(44);
}

function indexOfAscii(bytes: Uint8Array, text: string): number {
  outer: for (let index = 0; index <= bytes.length - text.length; index += 1) {
    for (let cursor = 0; cursor < text.length; cursor += 1) {
      if (bytes[index + cursor] !== text.charCodeAt(cursor)) continue outer;
    }
    return index;
  }
  return -1;
}
