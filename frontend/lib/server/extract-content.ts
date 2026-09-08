import {
  chatCompletionsUrl,
  openRouterHeaders,
  resolveLlmEndpoint,
  visionModel,
} from "@/lib/server/env";

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".bmp": "image/bmp",
};

const VISION_PROMPT =
  "Tu extrais le contenu utile d'un document visuel " +
  "(image, infographie, graphique, diapositive ou page scannée). " +
  "Restitue tout le texte lisible, les titres, légendes, chiffres, unités, " +
  "la structure des tableaux et le message des graphiques. " +
  "N'invente aucun chiffre absent. Réponds dans la langue du document.";

export async function extractFromBuffer(
  buffer: Buffer,
  filename: string,
): Promise<string> {
  const suffix = filename.includes(".")
    ? `.${filename.split(".").pop()?.toLowerCase()}`
    : "";

  if (suffix === ".pdf") return extractPdf(buffer);
  if (suffix === ".docx") return extractDocx(buffer);
  if (suffix === ".xlsx" || suffix === ".xlsm") return extractXlsx(buffer);
  if (suffix === ".csv") return extractCsv(buffer);
  if (suffix === ".pptx") return extractPptx(buffer);
  if (suffix === ".xls") {
    throw new Error(
      "Les anciens fichiers .xls doivent être enregistrés en .xlsx, puis renvoyés.",
    );
  }
  if (suffix === ".doc" || suffix === ".ppt") {
    throw new Error(
      "Enregistrez ce fichier au format .docx ou .pptx, puis renvoyez-le.",
    );
  }
  if (IMAGE_MIME[suffix]) {
    return describeImage(buffer, IMAGE_MIME[suffix]);
  }
  return decodeText(buffer);
}

export async function extractFromUrl(url: string): Promise<{ titre: string; text: string }> {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Indiquez une URL http ou https complète.");
  }

  const response = await fetch(url, {
    headers: { "User-Agent": "UbuntuIA-Indexer/1.0" },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error("La page n'a pas pu être récupérée. Vérifiez qu'elle est publique.");
  }

  const html = await response.text();
  const title =
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || parsed.hostname;
  const text = htmlToText(html);
  if (!text) {
    throw new Error("Aucun contenu textuel utile n'a été trouvé sur cette page.");
  }
  return { titre: title, text };
}

function decodeText(buffer: Buffer): string {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("Le fichier texte est vide.");
  return text;
}

function extractCsv(buffer: Buffer): string {
  const text = decodeText(buffer);
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .split(/[;,\t|]/)
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join(" | "),
    )
    .filter(Boolean)
    .join("\n");
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value.trim();
  if (!text) throw new Error("Le document Word ne contient pas de texte exploitable.");
  return text;
}

async function extractXlsx(buffer: Buffer): Promise<string> {
  try {
    return await extractXlsxWithExcelJs(buffer);
  } catch {
    return extractXlsxFromZip(buffer);
  }
}

async function extractXlsxWithExcelJs(buffer: Buffer): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never, {
    ignoreNodes: ["dataValidations", "extLst"],
  });
  const parts: string[] = [];
  workbook.eachSheet((sheet) => {
    const lines = [`# Feuille : ${sheet.name}`];
    sheet.eachRow((row) => {
      const cells = Array.isArray(row.values)
        ? row.values.slice(1).map(excelCellText).filter(Boolean)
        : [];
      if (cells.length) lines.push(cells.join(" | "));
    });
    if (lines.length > 1) parts.push(lines.join("\n"));
  });
  if (!parts.length) {
    throw new Error("Le classeur Excel ne contient pas de données exploitables.");
  }
  return parts.join("\n\n");
}

function excelCellText(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== "object") return String(value).trim();

  const cell = value as {
    richText?: { text?: string }[];
    result?: unknown;
    text?: string;
    hyperlink?: string;
    error?: string;
    formula?: string;
    sharedFormula?: string;
  };
  if (Array.isArray(cell.richText)) {
    return cell.richText
      .map((part) => part.text ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (Object.prototype.hasOwnProperty.call(cell, "result")) {
    return excelCellText(cell.result);
  }
  if (cell.text) return String(cell.text).replace(/\s+/g, " ").trim();
  if (cell.hyperlink) return String(cell.hyperlink).trim();
  return "";
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCharCode(Number(dec)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function extractXlsxFromZip(buffer: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  if (!workbookXml) {
    throw new Error("Le classeur Excel ne contient pas de données exploitables.");
  }

  const relsXml =
    (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const relTargets = new Map<string, string>();
  for (const match of relsXml.matchAll(
    /<Relationship\b([^>]*)\/?>/gi,
  )) {
    const attrs = match[1];
    const id = /\bId="([^"]+)"/i.exec(attrs)?.[1];
    const target = /\bTarget="([^"]+)"/i.exec(attrs)?.[1];
    if (id && target) relTargets.set(id, target);
  }

  const sharedXml =
    (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map(
    (match) =>
      [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
        .map((token) => decodeXmlEntities(token[1]))
        .join("")
        .replace(/\s+/g, " ")
        .trim(),
  );

  const parts: string[] = [];
  for (const match of workbookXml.matchAll(/<sheet\b([^>\/]*)/gi)) {
    const attrs = match[1];
    const name = decodeXmlEntities(/\bname="([^"]*)"/i.exec(attrs)?.[1] ?? "");
    const rid = /\br:id="([^"]*)"/i.exec(attrs)?.[1];
    const target = rid ? relTargets.get(rid) : undefined;
    if (!name || !target) continue;

    const path = target.replace(/^\//, "");
    const sheetPath = path.startsWith("xl/") ? path : `xl/${path}`;
    const sheetXml = await zip.file(sheetPath)?.async("string");
    if (!sheetXml) continue;

    const lines = [`# Feuille : ${name}`];
    for (const row of sheetXml.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/gi)) {
      const cells = [
        ...row[1].matchAll(/<(?:\w+:)?c\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/gi),
      ]
        .map((cell) => zipCellText(cell[1], cell[2] ?? "", shared))
        .filter(Boolean);
      if (cells.length) lines.push(cells.join(" | "));
    }
    if (lines.length > 1) parts.push(lines.join("\n"));
  }

  if (!parts.length) {
    throw new Error("Le classeur Excel ne contient pas de données exploitables.");
  }
  return parts.join("\n\n");
}

function zipCellText(attrs: string, body: string, shared: string[]): string {
  const type = /\bt="([^"]*)"/i.exec(attrs)?.[1] ?? "";
  if (type === "s") {
    const index = Number(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/i.exec(body)?.[1]);
    return Number.isFinite(index) ? shared[index] ?? "" : "";
  }
  if (type === "inlineStr" || type === "str") {
    return [...body.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gi)]
      .map((token) => decodeXmlEntities(token[1]))
      .join("")
      .replace(/\s+/g, " ")
      .trim() || decodeXmlEntities(
        /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/i.exec(body)?.[1] ?? "",
      ).trim();
  }
  if (type === "e" || type === "b") {
    const raw = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/i.exec(body)?.[1] ?? "";
    if (type === "e") return "";
    return raw === "1" ? "true" : "false";
  }
  const raw = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/i.exec(body)?.[1];
  return raw ? decodeXmlEntities(raw).trim() : "";
}

async function extractPptx(buffer: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const parts: string[] = [];
  for (const [index, name] of names.entries()) {
    const xml = await zip.files[name].async("string");
    const text = xml
      .replace(/<a:t[^>]*>/g, "")
      .replace(/<\/a:t>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    if (text) parts.push(`# Diapositive ${index + 1}\n${text}`);
  }
  if (!parts.length) {
    throw new Error("La présentation PowerPoint ne contient pas de texte exploitable.");
  }
  return parts.join("\n\n");
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  const joined = Array.isArray(text) ? text.join("\n\n") : text;
  const cleaned = joined.replace(/\s+\n/g, "\n").trim();
  if (cleaned) return cleaned;
  throw new Error(
    "Ce PDF n'a pas de texte extractible. Envoyez une version texte, ou une image de la page.",
  );
}

async function describeImage(buffer: Buffer, mime: string): Promise<string> {
  const endpoint = resolveLlmEndpoint();
  const encoded = buffer.toString("base64");
  const response = await fetch(chatCompletionsUrl(endpoint), {
    method: "POST",
    headers: openRouterHeaders(endpoint.key),
    body: JSON.stringify({
      model: visionModel(),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: VISION_PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:${mime};base64,${encoded}` },
            },
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error("La lecture visuelle de l'image a échoué.");
  }
  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = body.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("Le modèle n'a extrait aucun contenu de l'image.");
  return text;
}

export async function analyzeVisualAttachment(
  buffer: Buffer,
  mime: string,
  question: string,
): Promise<string> {
  const endpoint = resolveLlmEndpoint();
  const encoded = buffer.toString("base64");
  const response = await fetch(chatCompletionsUrl(endpoint), {
    method: "POST",
    headers: openRouterHeaders(endpoint.key),
    body: JSON.stringify({
      model: visionModel(),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Analyse cette image pour répondre à l'utilisateur. " +
                "Décris le contenu utile : texte, chiffres, schémas, objets, contexte. " +
                "Si l'image sert de modèle de style, extrais aussi la charte : couleurs hex exactes " +
                "(primaire, accent, fond, texte), polices perçues, logo, style des tableaux. " +
                "Si une couleur n'est pas lisible, dis-le plutôt que d'inventer. " +
                "N'invente aucun chiffre absent. Réponds dans la langue de la question. " +
                `Question : ${question.trim() || "Que montre cette image ?"}`,
            },
            {
              type: "image_url",
              image_url: { url: `data:${mime};base64,${encoded}` },
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    return describeImage(buffer, mime);
  }
  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = body.choices?.[0]?.message?.content?.trim() ?? "";
  return text || describeImage(buffer, mime);
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
