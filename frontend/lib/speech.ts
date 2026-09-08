type SpeechCtor = new () => SpeechRecognitionLike;

export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

let speakGeneration = 0;

export function getSpeechRecognitionCtor(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export function transcriptFromSpeechEvent(event: SpeechResultEvent): string {
  let text = "";
  for (let index = 0; index < event.results.length; index += 1) {
    text += event.results[index]?.[0]?.transcript ?? "";
  }
  return text.replace(/\s+/g, " ").trim();
}

export function unlockSpeech() {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const warm = new SpeechSynthesisUtterance(" ");
    warm.volume = 0;
    warm.rate = 1;
    warm.lang = "fr-FR";
    window.speechSynthesis.speak(warm);
    window.speechSynthesis.cancel();
  } catch {
    /* gestuelle utilisateur : débloque la synthèse pour la session */
  }
}

export async function speakText(text: string, lang = "fr-FR"): Promise<void> {
  const generation = ++speakGeneration;
  if (typeof window === "undefined" || !window.speechSynthesis) return;

  const spoken = text.replace(/\s+/g, " ").trim();
  if (!spoken) return;

  await ensureVoices();
  if (generation !== speakGeneration) return;

  window.speechSynthesis.cancel();
  const voice = pickFrenchVoice();
  const chunks = speechChunks(spoken);

  for (const chunk of chunks) {
    if (generation !== speakGeneration) return;
    await speakChunk(chunk, lang, voice, generation);
  }
}

export function stopSpeaking() {
  speakGeneration += 1;
  if (typeof window === "undefined") return;
  window.speechSynthesis?.cancel();
}

function speakChunk(
  chunk: string,
  lang: string,
  voice: SpeechSynthesisVoice | null,
  generation: number,
): Promise<void> {
  return new Promise((resolve) => {
    if (generation !== speakGeneration) {
      resolve();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.lang = lang;
    utterance.rate = 1.02;
    if (voice) utterance.voice = voice;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearInterval(keepAlive);
      window.clearTimeout(hardStop);
      window.clearTimeout(started);
      resolve();
    };

    const keepAlive = window.setInterval(() => {
      if (generation !== speakGeneration) {
        finish();
        return;
      }
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    }, 2_500);

    const hardStop = window.setTimeout(
      finish,
      Math.min(28_000, Math.max(6_000, chunk.length * 80)),
    );

    utterance.onend = finish;
    utterance.onerror = finish;

    window.speechSynthesis.speak(utterance);
    window.speechSynthesis.resume();

    const started = window.setTimeout(() => {
      if (settled || generation !== speakGeneration) {
        finish();
        return;
      }
      if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
        window.speechSynthesis.resume();
        window.speechSynthesis.speak(utterance);
      }
      window.setTimeout(() => {
        if (settled) return;
        if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
          finish();
        }
      }, 900);
    }, 700);
  });
}

function speechChunks(text: string, max = 240): string[] {
  const parts = text.split(/(?<=[.!?…;:])\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    const next = current ? `${current} ${part}` : part;
    if (next.length > max && current) {
      chunks.push(current);
      current = part;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text];
}

function pickFrenchVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const french = voices.filter((voice) => /^fr\b/i.test(voice.lang));
  return (
    french.find((voice) => /google|microsoft|natural|thomas|julie|hortense|denise|paul/i.test(voice.name)) ??
    french[0] ??
    voices.find((voice) => voice.default) ??
    voices[0] ??
    null
  );
}

function ensureVoices(): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis) return Promise.resolve();
  if (window.speechSynthesis.getVoices().length) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, 700);
    window.speechSynthesis.addEventListener("voiceschanged", done);
  });
}
