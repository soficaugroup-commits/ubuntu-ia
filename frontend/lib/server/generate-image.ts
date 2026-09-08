import "server-only";
import {
  imageModel,
  imagesUrl,
  openRouterHeaders,
  resolveLlmEndpoint,
} from "@/lib/server/env";
import type { GeneratedImage } from "@/lib/types";

const IMAGE_TIMEOUT_MS = 180_000;

export async function generateChatImage(
  prompt: string,
  references: string[] = [],
): Promise<GeneratedImage | null> {
  const endpoint = resolveLlmEndpoint();
  const model = imageModel(endpoint);
  const refs = references.filter(Boolean).slice(0, 4).map((url) => ({
    type: "image_url" as const,
    image_url: { url },
  }));
  const tries: Record<string, unknown>[] = refs.length
    ? [
        { prompt, n: 1, aspect_ratio: "3:4", quality: "high", input_references: refs },
        { prompt, aspect_ratio: "auto", input_references: refs },
        { prompt, input_references: refs },
      ]
    : [
        { prompt, n: 1, aspect_ratio: "1:1", quality: "high" },
        { prompt, aspect_ratio: "1:1" },
        { prompt },
      ];

  let lastError = "";
  for (const extra of tries) {
    try {
      const response = await fetch(imagesUrl(endpoint), {
        method: "POST",
        headers: openRouterHeaders(endpoint.key),
        body: JSON.stringify({ model, ...extra }),
        cache: "no-store",
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      });
      const raw = await response.text();
      if (!response.ok) {
        lastError = `${model} ${response.status}: ${raw.slice(0, 280)}`;
        console.error("[chat] image", lastError);
        continue;
      }
      const parsed = JSON.parse(raw) as {
        data?: { b64_json?: string; url?: string; media_type?: string }[];
      };
      const image = parsed.data?.[0];
      if (image?.b64_json) {
        const mime = image.media_type || "image/png";
        return {
          url: `data:${mime};base64,${image.b64_json}`,
          alt: prompt.trim().slice(0, 140),
        };
      }
      if (image?.url) {
        return { url: image.url, alt: prompt.trim().slice(0, 140) };
      }
      lastError = `${model}: réponse image sans fichier`;
    } catch (error) {
      lastError =
        error instanceof Error ? `${model}: ${error.message}` : `${model}: erreur image`;
      console.error("[chat] image", lastError);
    }
  }

  if (lastError) console.error("[chat] image failed", lastError);
  return null;
}
