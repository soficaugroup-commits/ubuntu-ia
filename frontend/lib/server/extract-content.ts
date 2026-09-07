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
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const parts: string[] = [];
  workbook.eachSheet((sheet) => {
    const lines = [`# Feuille : ${sheet.name}`];
    sheet.eachRow((row) => {
      const cells = Array.isArray(row.values)
        ? row.values
            .slice(1)
            .map((cell) => (cell == null ? "" : String(cell).trim()))
        : [];
      if (cells.some(Boolean)) lines.push(cells.join(" | "));
    });
    if (lines.length > 1) parts.push(lines.join("\n"));
  });
  if (!parts.length) {
    throw new Error("Le classeur Excel ne contient pas de données exploitables.");
  }
  return parts.join("\n\n");
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
