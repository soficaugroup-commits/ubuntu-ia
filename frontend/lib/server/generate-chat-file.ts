import "server-only";
import type { PreparedAttachment } from "@/lib/server/chat-attachments";
import { cloneDocxWithSpec } from "@/lib/server/clone-docx";
import { clonePptxWithSpec } from "@/lib/server/clone-pptx";
import { formatFromName } from "@/lib/server/design-dna";
import { plainFromSpec, specFromMarkdown } from "@/lib/server/document-spec";
import { buildDocx } from "@/lib/server/generate-chat-docx";
import { buildPdf, fillPdfForm } from "@/lib/server/generate-chat-pdf";
import { buildPptx } from "@/lib/server/generate-chat-pptx";
import { buildXlsx } from "@/lib/server/generate-chat-xlsx";
import { withLiteralLayouts } from "@/lib/server/slide-plan";
import {
  cleanSpec,
  fingerprintSpec,
  pickContentWorkbook,
  planStyleTransfer,
  textFromGenerated,
  verifyContent,
  type StyleJob,
} from "@/lib/server/style-transfer";
import { buildHtml } from "@/lib/server/generate-chat-html";
import {
  assertGuide,
  consultGuide,
  ensureContrast,
  stageDeliverable,
  type GuideBrief,
} from "@/lib/server/document-process";
import { storeGeneratedFile } from "@/lib/server/generated-files";
import type { FileFormat, GeneratedFile } from "@/lib/types";

const MAX_BYTES = 25 * 1024 * 1024;

const MIME: Record<FileFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv;charset=utf-8",
  txt: "text/plain;charset=utf-8",
  md: "text/markdown;charset=utf-8",
  json: "application/json",
  html: "text/html;charset=utf-8",
};

const EXT: Record<FileFormat, string> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
  csv: "csv",
  txt: "txt",
  md: "md",
  json: "json",
  html: "html",
};

export async function generateChatFiles(input: {
  question: string;
  content: string;
  formats: FileFormat[];
  attachments: PreparedAttachment[];
  userId?: string;
  onProgress?: (
    phase: "content" | "build",
    format?: FileFormat,
  ) => void | Promise<void>;
}): Promise<GeneratedFile[]> {
  const markdown = input.content.trim();
  if (!markdown || !input.formats.length) return [];

  await input.onProgress?.("content");
  const spec = cleanSpec(specFromMarkdown(markdown, input.question));
  const job = await planStyleTransfer({
    question: input.question,
    attachments: input.attachments,
    spec,
    outputFormats: input.formats,
  });
  const tokens = fingerprintSpec(spec);
  const contentAttachment = job.content && job.content !== job.style ? job.content : undefined;
  const stem = fileStem(
    input.question,
    contentAttachment?.name ?? (job.sameDocument ? job.style?.name : input.attachments[0]?.name),
  );
  const files: GeneratedFile[] = [];

  for (const format of input.formats) {
    try {
      const guide = consultGuide(format);
      await input.onProgress?.("build", format);
      let bytes = await buildFormat(format, markdown, spec, input.attachments, job, guide);
      if (!bytes || bytes.length === 0 || bytes.length > MAX_BYTES) continue;
      let produced = await textFromGenerated(format, bytes).catch(() => "");
      let check = verifyContent(tokens, produced);
      if (!check.ok && (format === "pptx" || format === "docx" || format === "pdf")) {
        const retry = await buildFormat(format, markdown, withLiteralLayouts(spec), input.attachments, job, guide);
        const retryText = await textFromGenerated(format, retry).catch(() => "");
        const retryCheck = verifyContent(tokens, retryText);
        if (retryCheck.missing.length < check.missing.length) {
          bytes = retry;
          check = retryCheck;
        }
      }
      if (!check.ok) {
        console.warn("[chat] content-guard", format, check.missing);
      }
      const staged = await stageDeliverable(`${stem}.${EXT[format]}`, bytes);
      const stored = await storeGeneratedFile({
        userId: input.userId,
        name: `${stem}.${EXT[format]}`,
        mime: MIME[format],
        format,
        bytes: staged,
      });
      files.push({
        id: crypto.randomUUID(),
        name: `${stem}.${EXT[format]}`,
        mime: MIME[format],
        format,
        url: stored ?? `data:${MIME[format]};base64,${staged.toString("base64")}`,
      });
    } catch (error) {
      console.error("[chat] file", format, error);
    }
  }
  return files;
}

async function buildFormat(
  format: FileFormat,
  markdown: string,
  spec: ReturnType<typeof specFromMarkdown>,
  attachments: PreparedAttachment[],
  job: StyleJob,
  guide: GuideBrief,
): Promise<Uint8Array> {
  assertGuide(guide, format);
  const dna = ensureContrast(job.dna);
  const { style } = job;
  if (format === "md") return encodeText(markdown);
  if (format === "txt") return encodeText(plainFromSpec(spec));
  if (format === "json") return encodeText(jsonFromMarkdown(markdown, spec));
  if (format === "csv") return encodeText(csvFromSpec(spec));
  if (format === "xlsx") {
    const source = pickContentWorkbook(attachments, style, spec);
    return buildXlsx(spec, source ? [source] : [], dna);
  }
  if (format === "docx") {
    if (style?.buffer && formatFromName(style.name, style.mime) === "docx") {
      try {
        const cloned = await cloneDocxWithSpec(style.buffer, spec, dna);
        const produced = await textFromGenerated("docx", cloned);
        const check = verifyContent(fingerprintSpec(spec), produced);
        if (check.ok) return cloned;
        console.warn("[chat] clone docx regression", check.missing);
      } catch (error) {
        console.error("[chat] clone docx", error);
      }
    }
    return buildDocx(spec, dna);
  }
  if (format === "html") return buildHtml(spec, dna);
  if (format === "pptx") {
    const images = attachments
      .filter((item) => item.kind === "image" && item.buffer && item !== style)
      .map((item) => ({ mime: item.mime, bytes: item.buffer as Buffer }));
    if (style?.buffer && formatFromName(style.name, style.mime) === "pptx") {
      try {
        const cloned = await clonePptxWithSpec(style.buffer, spec, {
          synthesized: job.editorialSynthesis,
        });
        const produced = await textFromGenerated("pptx", cloned);
        const check = verifyContent(fingerprintSpec(spec), produced);
        if (check.ok) return cloned;
        console.warn("[chat] clone pptx regression", check.missing);
      } catch (error) {
        console.error("[chat] clone pptx", error);
      }
    }
    return buildPptx(spec, dna, { synthesized: job.editorialSynthesis, images });
  }
  const formPdf = attachments.find(
    (item) => item.buffer && formatFromName(item.name, item.mime) === "pdf",
  );
  if (formPdf?.buffer) {
    const filled = await fillPdfForm(formPdf.buffer, spec);
    if (filled) return filled;
  }
  return buildPdf(spec, dna);
}

function fileStem(question: string, attachedName?: string): string {
  if (attachedName) {
    const base = attachedName.replace(/\.[^.]+$/, "").trim();
    if (base) return `${slug(base)}-adapte`;
  }
  const words = question
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(" ");
  return slug(words) || "ubuntu-ia";
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function jsonFromMarkdown(markdown: string, spec: ReturnType<typeof specFromMarkdown>): string {
  const fence = /```(?:ubuntu-ia-doc|json)\s*([\s\S]*?)```/i.exec(markdown);
  if (fence?.[1]?.trim()) {
    try {
      return JSON.stringify(JSON.parse(fence[1]), null, 2);
    } catch {
      return fence[1].trim();
    }
  }
  return JSON.stringify(spec, null, 2);
}

function csvFromSpec(spec: ReturnType<typeof specFromMarkdown>): string {
  const table = spec.sections.find((section) => section.table)?.table;
  if (!table) {
    return `"contenu"\n"${plainFromSpec(spec).replace(/"/g, '""')}"`;
  }
  const lines = [table.headers, ...table.rows].map((row) =>
    row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(";"),
  );
  return `\uFEFF${lines.join("\n")}`;
}
