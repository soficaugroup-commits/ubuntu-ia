import "server-only";
import {
  defaultDna,
  describeDesign,
  dnaFromVisibleText,
  extractDesignDna,
  mergeDna,
  type DesignDna,
} from "@/lib/server/design-dna";
import {
  analyzeVisualAttachment,
  extractFromBuffer,
} from "@/lib/server/extract-content";
import type { ChatAttachment } from "@/lib/types";

export type PreparedAttachment = {
  name: string;
  mime: string;
  kind: "image" | "file";
  note: string;
  dataUrl?: string;
  fileData?: string;
  buffer?: Buffer;
  design?: DesignDna;
};

export async function prepareChatAttachments(
  attachments: ChatAttachment[] | undefined,
  question: string,
): Promise<PreparedAttachment[]> {
  if (!attachments?.length) return [];
  const prepared: PreparedAttachment[] = [];
  for (const item of attachments) {
    if (!item.contentBase64) {
      prepared.push({
        name: item.name,
        mime: item.mime,
        kind: item.kind,
        note: "Fichier nommé mais sans contenu transmissible (réessai sans la pièce, ou joignez-le à nouveau).",
      });
      continue;
    }
    const buffer = Buffer.from(item.contentBase64, "base64");
    const mime = item.mime || guessMime(item.name);
    try {
      if (item.kind === "image") {
        const note = await analyzeVisualAttachment(buffer, mime, question);
        const design = mergeDna(
          await extractDesignDna({ name: item.name, mime, buffer }).catch(() => defaultDna()),
          dnaFromVisibleText(note),
        );
        prepared.push({
          name: item.name,
          mime,
          kind: "image",
          note: `${note}\n\n${describeDesign(design)}`,
          dataUrl: `data:${mime};base64,${item.contentBase64}`,
          buffer,
          design,
        });
        continue;
      }
      const note = await extractFromBuffer(buffer, item.name);
      const design = mergeDna(
        await extractDesignDna({ name: item.name, mime, buffer }).catch(() => defaultDna()),
        dnaFromVisibleText(note),
      );
      prepared.push({
        name: item.name,
        mime,
        kind: "file",
        note: `${note.slice(0, 38_000)}\n\n${describeDesign(design)}`,
        fileData:
          mime === "application/pdf" || item.name.toLowerCase().endsWith(".pdf")
            ? `data:application/pdf;base64,${item.contentBase64}`
            : undefined,
        buffer,
        design,
      });
    } catch (error) {
      prepared.push({
        name: item.name,
        mime,
        kind: item.kind,
        note:
          error instanceof Error
            ? error.message
            : "Cette pièce jointe n'a pas pu être lue.",
      });
    }
  }
  return prepared;
}

function guessMime(name: string): string {
  const suffix = name.includes(".")
    ? `.${name.split(".").pop()?.toLowerCase()}`
    : "";
  if (suffix === ".png") return "image/png";
  if (suffix === ".jpg" || suffix === ".jpeg") return "image/jpeg";
  if (suffix === ".gif") return "image/gif";
  if (suffix === ".webp") return "image/webp";
  if (suffix === ".pdf") return "application/pdf";
  return "application/octet-stream";
}
