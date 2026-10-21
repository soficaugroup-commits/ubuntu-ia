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
import { validateGenerated } from "@/lib/server/office-validate";
import { reviewDeliverable } from "@/lib/server/document-review";
import { verifyInternalClaims } from "@/lib/server/document-review-llm";
import { fillTemplate } from "@/lib/server/template-fill";
import type { FileFormat, GeneratedFile, ReviewReport, TemplateFormat } from "@/lib/types";

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

export type ChatFileTemplate = { format: TemplateFormat; bytes: Buffer; nom: string };

export async function generateChatFiles(input: {
  question: string;
  content: string;
  formats: FileFormat[];
  attachments: PreparedAttachment[];
  userId?: string;
  /** Extraite des pièces et des sources cités, pour la relecture des chiffres. */
  excerpts?: string[];
  citationCount?: number;
  /** Modèle du groupe : le livrable de ce format est produit en remplissant le modèle. */
  template?: ChatFileTemplate;
  onProgress?: (
    phase: "content" | "review" | "build" | "invalid" | "template-missing" | "template-fallback",
    format?: FileFormat,
    detail?: string,
  ) => void | Promise<void>;
}): Promise<GeneratedFile[]> {
  const markdown = input.content.trim();
  if (!markdown || !input.formats.length) return [];

  await input.onProgress?.("content");
  const draft = cleanSpec(specFromMarkdown(markdown, input.question));
  await input.onProgress?.("review");
  const reviewed = await reviewDeliverable({
    spec: draft,
    question: input.question,
    excerpts: input.excerpts ?? input.attachments.map((item) => item.note).filter(Boolean),
    citationCount: input.citationCount ?? 0,
    verifyClaims: (spec, excerpts) => verifyInternalClaims(spec, excerpts),
  }).catch((error) => {
    console.error("[chat] relecture", error);
    return { spec: draft, report: { statut: "a_verifier" as const, corrections: [], alertes: [] } };
  });
  const spec = reviewed.spec;
  const relecture = reviewed.report;
  const job = await planStyleTransfer({
    question: input.question,
    attachments: input.attachments,
    spec,
    outputFormats: input.formats,
  });
  const tokens = fingerprintSpec(spec);
  const contentAttachment = job.content && job.content !== job.style ? job.content : undefined;
  const stem = input.template
    ? slug(input.template.nom) || "modele"
    : fileStem(
        input.question,
        contentAttachment?.name ?? (job.sameDocument ? job.style?.name : input.attachments[0]?.name),
      );
  const files: GeneratedFile[] = [];

  for (const format of input.formats) {
    try {
      const guide = consultGuide(format);
      await input.onProgress?.("build", format);
      if (input.template && input.template.format === format) {
        const filled = await fillFromTemplate(input.template, spec, job, input.onProgress);
        if (filled) {
          files.push(await deliver(`${stem}.${EXT[format]}`, format, filled, input.userId, relecture));
          continue;
        }
      }
      let bytes = await buildFormat(format, markdown, spec, input.attachments, job, guide);
      if (!bytes || bytes.length === 0 || bytes.length > MAX_BYTES) continue;
      const produced = await textFromGenerated(format, bytes).catch(() => "");
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
      let validation = await validateGenerated(format, bytes);
      if (!validation.ok) {
        console.error("[chat] validation", format, validation.problems);
        bytes = await buildFormat(format, markdown, withLiteralLayouts(spec), input.attachments, job, guide);
        validation = await validateGenerated(format, bytes);
      }
      if (!validation.ok) {
        console.error("[chat] validation après régénération", format, validation.problems);
        await input.onProgress?.("invalid", format);
        continue;
      }
      files.push(await deliver(`${stem}.${EXT[format]}`, format, bytes, input.userId, relecture));
    } catch (error) {
      console.error("[chat] file", format, error);
    }
  }
  return files;
}

async function deliver(
  name: string,
  format: FileFormat,
  bytes: Uint8Array,
  userId?: string,
  relecture?: ReviewReport,
): Promise<GeneratedFile> {
  const staged = await stageDeliverable(name, bytes);
  const stored = await storeGeneratedFile({ userId, name, mime: MIME[format], format, bytes: staged });
  return {
    id: crypto.randomUUID(),
    name,
    mime: MIME[format],
    format,
    url: stored ?? `data:${MIME[format]};base64,${staged.toString("base64")}`,
    relecture,
  };
}

/**
 * Remplit le modèle du groupe. En cas d'échec ou de fichier invalide, renvoie null :
 * l'appelant produit alors le livrable avec la charte SOFICAU et l'étape l'indique.
 */
async function fillFromTemplate(
  template: ChatFileTemplate,
  spec: ReturnType<typeof specFromMarkdown>,
  job: StyleJob,
  onProgress?: (
    phase: "template-missing" | "template-fallback",
    format?: FileFormat,
    detail?: string,
  ) => void | Promise<void>,
): Promise<Uint8Array | null> {
  try {
    const result = await fillTemplate(template.format, template.bytes, spec, {
      dna: ensureContrast(job.dna),
      synthesized: job.editorialSynthesis,
    });
    const validation = await validateGenerated(template.format, result.bytes);
    if (!validation.ok) {
      console.error("[chat] modèle invalide", template.format, validation.problems);
      await onProgress?.("template-fallback", template.format);
      return null;
    }
    if (result.warnings.length) console.warn("[chat] modèle", result.warnings);
    if (result.missing.length) await onProgress?.("template-missing", template.format, result.missing.join(", "));
    return result.bytes;
  } catch (error) {
    console.error("[chat] modèle", template.format, error);
    await onProgress?.("template-fallback", template.format);
    return null;
  }
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
