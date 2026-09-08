import { inflateRawSync, inflateSync } from "zlib";
import JSZip from "jszip";
import { BRAND } from "@/lib/server/document-spec";

export type StyleFormat = "docx" | "pptx" | "xlsx" | "pdf" | "image" | "unknown";

export type DesignAsset = {
  name: string;
  mime: "image/png" | "image/jpeg";
  bytes: Buffer;
  width?: number;
  height?: number;
};

export type DesignDna = {
  sourceName?: string;
  sourceFormat: StyleFormat;
  primary: string;
  accent: string;
  canvas: string;
  text: string;
  muted: string;
  inverse: string;
  chartColors: string[];
  headingFont: string;
  bodyFont: string;
  headerLabel?: string;
  tableHeaderFill: string;
  tableBodyFill: string;
  zebra: boolean;
  frozenSource: boolean;
  assumptions: string[];
  logo?: DesignAsset;
};

export type DocDesign = {
  primaire?: string;
  accent?: string;
  fond?: string;
  texte?: string;
  policeTitre?: string;
  policeCorps?: string;
  primary?: string;
  canvas?: string;
  text?: string;
  headingFont?: string;
  bodyFont?: string;
};

const STYLE_HINT =
  /\b(style|design|mise en forme|mod[eè]le|template|charte|habillage|th[eè]me|comme (le|la|ce|cet)|reproduis|applique|inspire[- ]toi)\b/i;

export function defaultDna(): DesignDna {
  return {
    sourceFormat: "unknown",
    primary: BRAND.navy,
    accent: BRAND.gold,
    canvas: BRAND.canvas,
    text: BRAND.navy,
    muted: BRAND.mid,
    inverse: BRAND.white,
    chartColors: [...BRAND.chartColors],
    headingFont: "Calibri",
    bodyFont: "Calibri",
    tableHeaderFill: BRAND.navy,
    tableBodyFill: BRAND.canvas,
    zebra: true,
    frozenSource: false,
    assumptions: [],
  };
}

export function isStyleTransfer(question: string): boolean {
  return STYLE_HINT.test(question);
}

export function pickStyleAttachment<T extends { name: string; mime: string }>(
  question: string,
  attachments: T[],
): T | undefined {
  if (!attachments.length) return undefined;
  const lower = question.toLowerCase();
  const named = attachments.find((item) => {
    const base = item.name.replace(/\.[^.]+$/, "").toLowerCase();
    return base.length > 2 && lower.includes(base);
  });
  if (named && (STYLE_HINT.test(question) || attachments.length > 1)) return named;

  const formats = attachments.map((item) => formatFromName(item.name, item.mime));
  const frozen = attachments.find((_, index) => formats[index] === "pdf" || formats[index] === "image");
  const office = attachments.find((_, index) =>
    formats[index] === "docx" || formats[index] === "pptx" || formats[index] === "xlsx",
  );
  if (frozen && office && frozen !== office) return frozen;

  if (STYLE_HINT.test(question)) return attachments[0];
  return attachments.find((item) => formatFromName(item.name, item.mime) !== "unknown") ?? attachments[0];
}

export async function extractDesignDna(input: {
  name: string;
  mime: string;
  buffer?: Buffer;
}): Promise<DesignDna> {
  const base = defaultDna();
  base.sourceName = input.name;
  base.sourceFormat = formatFromName(input.name, input.mime);
  if (!input.buffer?.length) return base;

  if (base.sourceFormat === "pdf" || base.sourceFormat === "image") {
    base.frozenSource = true;
  }

  if (base.sourceFormat === "image") {
    return { ...base, ...dnaFromRaster(input.buffer) };
  }

  if (base.sourceFormat === "pdf") {
    return { ...base, ...(await dnaFromPdf(input.buffer)) };
  }

  if (base.sourceFormat === "docx" || base.sourceFormat === "pptx" || base.sourceFormat === "xlsx") {
    try {
      const zip = await JSZip.loadAsync(input.buffer);
      const fromTheme = await dnaFromTheme(zip);
      const fromTables = await tableLooksFromZip(zip);
      const headerLabel = base.sourceFormat === "docx" ? await headerFromZip(zip) : undefined;
      const logo = await logoFromZip(zip);
      return {
        ...base,
        ...fromTheme,
        ...fromTables,
        headerLabel: headerLabel || fromTheme.headerLabel,
        logo: logo ?? fromTheme.logo,
      };
    } catch {
      return {
        ...base,
        assumptions: ["Archive Office illisible : charte Ubuntu IA utilisée par défaut."],
      };
    }
  }
  return base;
}

export function mergeDna(...parts: Array<Partial<DesignDna> | DocDesign | undefined | null>): DesignDna {
  const dna = defaultDna();
  for (const part of parts) {
    if (!part) continue;
    const row = part as Record<string, unknown>;
    const primary = hex(row.primary ?? row.primaire);
    const accent = hex(row.accent);
    const canvas = hex(row.canvas ?? row.fond);
    const text = hex(row.text ?? row.texte);
    if (primary) dna.primary = primary;
    if (accent) dna.accent = accent;
    if (canvas) dna.canvas = canvas;
    if (text) dna.text = text;
    if (typeof row.headingFont === "string") dna.headingFont = row.headingFont;
    if (typeof row.bodyFont === "string") dna.bodyFont = row.bodyFont;
    if (typeof row.policeTitre === "string") dna.headingFont = row.policeTitre;
    if (typeof row.policeCorps === "string") dna.bodyFont = row.policeCorps;
    if (typeof row.sourceName === "string") dna.sourceName = row.sourceName;
    if (typeof row.sourceFormat === "string") dna.sourceFormat = row.sourceFormat as StyleFormat;
    if (typeof row.headerLabel === "string") dna.headerLabel = row.headerLabel;
    const tableHeader = hex(row.tableHeaderFill);
    const tableBody = hex(row.tableBodyFill);
    if (tableHeader) dna.tableHeaderFill = tableHeader;
    if (tableBody) dna.tableBodyFill = tableBody;
    if (typeof row.zebra === "boolean") dna.zebra = row.zebra;
    if (typeof row.frozenSource === "boolean") dna.frozenSource = row.frozenSource;
    if (Array.isArray(row.assumptions)) {
      dna.assumptions = uniqueTexts([...dna.assumptions, ...row.assumptions.map(String)]);
    }
    if (row.logo && typeof row.logo === "object") dna.logo = row.logo as DesignAsset;
    if (Array.isArray(row.chartColors)) {
      const colors = row.chartColors.map((item) => hex(item)).filter((item): item is string => Boolean(item));
      if (colors.length) dna.chartColors = colors;
    }
  }
  dna.tableHeaderFill = dna.tableHeaderFill || dna.primary;
  dna.tableBodyFill = dna.tableBodyFill || dna.canvas;
  dna.muted = mix(dna.primary, dna.canvas, 0.45);
  dna.inverse = isDark(dna.primary) ? "FFFFFF" : dna.text;
  dna.chartColors = uniqueHex([dna.primary, dna.accent, ...dna.chartColors, BRAND.mid, BRAND.sand]).slice(0, 6);
  return dna;
}

export function describeDesign(dna: DesignDna): string {
  const origin = dna.sourceName ? ` de « ${dna.sourceName} »` : "";
  const frozen = dna.frozenSource ? " Source figée : n'en extraire que le style, jamais le texte à réinjecter tel quel." : "";
  const assumed = dna.assumptions.length ? ` Hypothèses : ${dna.assumptions.join(" ")}` : "";
  return `Style visuel détecté${origin} : primaire #${dna.primary}, accent #${dna.accent}, fond #${dna.canvas}, texte #${dna.text}, tableaux #${dna.tableHeaderFill}/#${dna.tableBodyFill}, polices ${dna.headingFont} / ${dna.bodyFont}.${frozen}${assumed} Reproduis ce système visuel dans le livrable demandé.`;
}

export function dnaFromVisibleText(text: string): Partial<DesignDna> {
  if (!text.trim()) return {};
  const found = [...text.matchAll(/#([0-9A-Fa-f]{6})\b/g)].map((match) => match[1].toUpperCase());
  const palette = pickPalette(found);
  const heading =
    /\b(Calibri|Cambria|Arial|Georgia|Garamond|Verdana|Tahoma|Trebuchet MS|Times New Roman|Poppins)\b/i.exec(
      text,
    )?.[1];
  const body =
    /\b(Calibri|Cambria|Arial|Georgia|Garamond|Verdana|Tahoma|Trebuchet MS|Times New Roman|Poppins)\b/gi.exec(
      text.slice(text.indexOf(heading ?? "") + (heading?.length ?? 0)),
    )?.[1];
  return {
    ...palette,
    headingFont: heading,
    bodyFont: body || heading,
  };
}

export function argb(value: string): string {
  return `FF${normalizeHex(value)}`;
}

export function hexRgb(value: string): { r: number; g: number; b: number } {
  const n = Number.parseInt(normalizeHex(value), 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

export function pptFont(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("cambria")) return "Cambria";
  if (lower.includes("calibri")) return "Calibri";
  return "Arial";
}

export function wordFont(name: string): string {
  const allowed = [
    "Calibri",
    "Cambria",
    "Arial",
    "Times New Roman",
    "Georgia",
    "Garamond",
    "Trebuchet MS",
    "Verdana",
    "Tahoma",
    "Consolas",
  ];
  return allowed.find((item) => item.toLowerCase() === name.toLowerCase()) ?? "Calibri";
}

export function formatFromName(name: string, mime = ""): StyleFormat {
  const lower = `${name} ${mime}`.toLowerCase();
  if (lower.includes("wordprocessing") || /\.docx?\b/.test(lower)) return "docx";
  if (lower.includes("presentation") || /\.pptx?\b/.test(lower) || lower.includes(".potx")) return "pptx";
  if (lower.includes("spreadsheet") || /\.xlsx?\b/.test(lower)) return "xlsx";
  if (lower.includes("pdf") || lower.endsWith(".pdf")) return "pdf";
  if (lower.includes("image/") || /\.(png|jpe?g|webp|gif)$/.test(lower)) return "image";
  return "unknown";
}

async function dnaFromTheme(zip: JSZip): Promise<Partial<DesignDna>> {
  const themeFile = (zip.file(/theme\/theme\d+\.xml$/i) ?? [])[0];
  const xml = themeFile ? await themeFile.async("string") : "";
  const scheme = /<(?:a:)?clrScheme\b[^>]*>([\s\S]*?)<\/(?:a:)?clrScheme>/i.exec(xml)?.[1] ?? "";
  const dk1 = themeColor(scheme, "dk1") ?? themeColor(scheme, "dk2");
  const lt1 = themeColor(scheme, "lt1") ?? themeColor(scheme, "lt2") ?? "FFFFFF";
  const accents = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"]
    .map((name) => themeColor(scheme, name))
    .filter((item): item is string => Boolean(item));
  const primary = dk1 && !isNearBlack(dk1) && !isNearWhite(dk1) ? dk1 : accents[0] ?? BRAND.navy;
  const accent = accents.find((item) => item !== primary) ?? BRAND.gold;
  const text = dk1 && !isNearWhite(dk1) ? dk1 : primary;
  const canvas = lt1 && !isNearBlack(lt1) ? lt1 : BRAND.canvas;
  const major = /<(?:a:)?majorFont>[\s\S]*?<(?:a:)?latin\b[^>]*typeface="([^"]+)"/i.exec(xml)?.[1];
  const minor = /<(?:a:)?minorFont>[\s\S]*?<(?:a:)?latin\b[^>]*typeface="([^"]+)"/i.exec(xml)?.[1];
  const headingColor = await headingColorFromStyles(zip);
  return {
    primary: headingColor ?? primary,
    accent,
    canvas,
    text,
    chartColors: uniqueHex([primary, accent, ...accents]),
    headingFont: major || "Calibri",
    bodyFont: minor || major || "Calibri",
  };
}

async function headingColorFromStyles(zip: JSZip): Promise<string | undefined> {
  const styles = zip.file("word/styles.xml");
  if (!styles) return undefined;
  const xml = await styles.async("string");
  const heading =
    /<(?:w:)?style\b[^>]*styleId="(?:Heading1|Titre1)"[^>]*>[\s\S]*?<\/(?:w:)?style>/i.exec(xml)?.[0] ?? "";
  return /<(?:w:)?color\b[^>]*w:val="([0-9A-Fa-f]{6})"/i.exec(heading)?.[1]?.toUpperCase();
}

async function headerFromZip(zip: JSZip): Promise<string | undefined> {
  const file = (zip.file(/word\/header\d*\.xml$/i) ?? [])[0];
  if (!file) return undefined;
  const xml = await file.async("string");
  const text = xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return text || undefined;
}

async function dnaFromPdf(buffer: Buffer): Promise<Partial<DesignDna>> {
  const decoded = decodePdfStreams(buffer);
  const palette = pickPalette(collectHex(decoded));
  const logo = firstEmbeddedImage(buffer);
  const assumptions: string[] = [];
  if (!palette.primary) {
    assumptions.push("Couleurs PDF partiellement lisibles : approximation à partir des flux décodés, sinon charte Ubuntu IA.");
  }
  if (!logo) {
    assumptions.push("Aucun logo extractible détecté dans le PDF.");
  }
  try {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(buffer);
    const page = pdf.getPage(0);
    const { width, height } = page.getSize();
    return {
      ...palette,
      canvas: palette.canvas ?? (height > width ? BRAND.canvas : "F4F7F9"),
      logo,
      frozenSource: true,
      assumptions,
    };
  } catch {
    return { ...palette, logo, frozenSource: true, assumptions };
  }
}

async function tableLooksFromZip(zip: JSZip): Promise<Partial<DesignDna>> {
  const files = [
    zip.file("word/document.xml"),
    ...(zip.file(/ppt\/slides\/slide\d+\.xml$/i) ?? []),
    ...(zip.file(/xl\/worksheets\/sheet\d+\.xml$/i) ?? []),
    zip.file("xl/styles.xml"),
  ].filter(Boolean);
  const fills: string[] = [];
  for (const file of files.slice(0, 8)) {
    const xml = await file!.async("string");
    for (const match of xml.matchAll(/w:fill="([0-9A-Fa-f]{6})"/gi)) {
      fills.push(match[1].toUpperCase());
    }
    for (const match of xml.matchAll(/srgbClr\b[^>]*val="([0-9A-Fa-f]{6})"/gi)) {
      fills.push(match[1].toUpperCase());
    }
    for (const match of xml.matchAll(/fgColor\b[^>]*rgb="FF([0-9A-Fa-f]{6})"/gi)) {
      fills.push(match[1].toUpperCase());
    }
  }
  const useful = fills.filter((item) => !isNearBlack(item) && !isNearWhite(item));
  if (!useful.length) return {};
  return {
    tableHeaderFill: useful[0],
    tableBodyFill: useful.find((item) => item !== useful[0]) ?? BRAND.canvas,
    zebra: useful.length > 2,
  };
}

async function logoFromZip(zip: JSZip): Promise<DesignAsset | undefined> {
  const media = Object.keys(zip.files)
    .filter((name) => /\.(png|jpe?g)$/i.test(name) && /media|image|logo|header|brand/i.test(name))
    .sort((a, b) => scoreMediaName(a) - scoreMediaName(b));
  for (const name of media) {
    const bytes = Buffer.from(await zip.files[name].async("uint8array"));
    if (bytes.length < 2_000 || bytes.length > 400_000) continue;
    const mime = name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const size = rasterSize(bytes, mime);
    return { name: name.split("/").pop() || "logo", mime, bytes, ...size };
  }
  return undefined;
}

function dnaFromRaster(buffer: Buffer): Partial<DesignDna> {
  const png = paletteFromPng(buffer);
  const logo = buffer.length >= 2_000 && buffer.length <= 400_000
    ? ({
        name: "reference",
        mime: buffer[0] === 0x89 ? "image/png" : "image/jpeg",
        bytes: buffer,
        ...rasterSize(buffer, buffer[0] === 0x89 ? "image/png" : "image/jpeg"),
      } satisfies DesignAsset)
    : undefined;
  if (png.primary) {
    return { ...png, logo, frozenSource: true };
  }
  return {
    logo,
    frozenSource: true,
    assumptions: ["Image en couleurs vraies : palette non extraite au pixel ; s'appuyer sur le bloc design du modèle."],
  };
}

function paletteFromPng(buffer: Buffer): Partial<DesignDna> {
  if (buffer.length < 24 || buffer[0] !== 0x89) return {};
  let offset = 8;
  while (offset + 8 < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "PLTE" && length >= 6) {
      const colors: string[] = [];
      const start = offset + 8;
      for (let i = 0; i + 2 < length; i += 3) {
        colors.push(rgbToHex(buffer[start + i], buffer[start + i + 1], buffer[start + i + 2]));
      }
      return pickPalette(colors);
    }
    if (type === "IEND") break;
    offset += 12 + length;
  }
  return {};
}

function decodePdfStreams(buffer: Buffer): string {
  const latin = buffer.toString("latin1");
  const parts = [latin];
  let count = 0;
  for (const match of latin.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    if (count >= 12) break;
    const raw = Buffer.from(match[1], "latin1");
    if (raw.length > 800_000) continue;
    const inflated = tryInflate(raw);
    if (inflated && inflated.length < 500_000) {
      parts.push(inflated.toString("latin1"));
      count += 1;
    }
  }
  return parts.join("\n");
}

function tryInflate(raw: Buffer): Buffer | undefined {
  for (const fn of [inflateSync, inflateRawSync]) {
    try {
      return fn(raw);
    } catch {
      /* flux non compressé ou filtre différent */
    }
  }
  return undefined;
}

function collectHex(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/#([0-9A-Fa-f]{6})\b/g)) {
    found.push(match[1].toUpperCase());
  }
  for (const match of text.matchAll(/<([0-9A-Fa-f]{6})>/g)) {
    found.push(match[1].toUpperCase());
  }
  for (const match of text.matchAll(/(\d(?:\.\d+)?)\s+(\d(?:\.\d+)?)\s+(\d(?:\.\d+)?)\s+r[gG]/g)) {
    const r = Number(match[1]);
    const g = Number(match[2]);
    const b = Number(match[3]);
    if ([r, g, b].some((n) => n > 1.01)) continue;
    found.push(rgbToHex(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)));
  }
  return found;
}

function firstEmbeddedImage(buffer: Buffer): DesignAsset | undefined {
  const jpeg = sliceMarker(buffer, Buffer.from([0xff, 0xd8, 0xff]), Buffer.from([0xff, 0xd9]), "image/jpeg");
  if (jpeg) return jpeg;
  const pngStart = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const iend = Buffer.from("IEND");
  const start = buffer.indexOf(pngStart);
  if (start < 0) return undefined;
  const end = buffer.indexOf(iend, start);
  if (end < 0) return undefined;
  const bytes = buffer.subarray(start, end + 8);
  if (bytes.length < 2_000 || bytes.length > 400_000) return undefined;
  return {
    name: "logo-pdf.png",
    mime: "image/png",
    bytes: Buffer.from(bytes),
    ...rasterSize(bytes, "image/png"),
  };
}

function sliceMarker(
  buffer: Buffer,
  start: Buffer,
  end: Buffer,
  mime: "image/jpeg",
): DesignAsset | undefined {
  const from = buffer.indexOf(start);
  if (from < 0) return undefined;
  const to = buffer.indexOf(end, from + start.length);
  if (to < 0) return undefined;
  const bytes = buffer.subarray(from, to + end.length);
  if (bytes.length < 2_000 || bytes.length > 400_000) return undefined;
  return {
    name: "logo-pdf.jpg",
    mime,
    bytes: Buffer.from(bytes),
    ...rasterSize(bytes, mime),
  };
}

export function fitLogo(
  logo: DesignAsset,
  maxW: number,
  maxH: number,
): { w: number; h: number } {
  const width = logo.width || maxW;
  const height = logo.height || maxH;
  const scale = Math.min(maxW / width, maxH / height, 1);
  return { w: Math.max(8, width * scale), h: Math.max(8, height * scale) };
}

export function rasterSize(
  buffer: Buffer,
  mime: "image/png" | "image/jpeg",
): { width?: number; height?: number } {
  try {
    if (mime === "image/png" && buffer.length >= 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mime === "image/jpeg") {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xc3) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
  } catch {
    return {};
  }
  return {};
}

function pickPalette(values: string[]): Partial<DesignDna> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const cleaned = hex(value);
    if (!cleaned || isNearBlack(cleaned) || isNearWhite(cleaned)) continue;
    counts.set(cleaned, (counts.get(cleaned) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value);
  if (!ranked.length) return {};
  const primary = ranked.find((item) => isDark(item)) ?? ranked[0];
  const accent = ranked.find((item) => item !== primary && !isDark(item)) ?? ranked.find((item) => item !== primary) ?? BRAND.gold;
  const canvas = ranked.find((item) => item !== primary && item !== accent && !isDark(item)) ?? BRAND.canvas;
  const text = isDark(primary) ? primary : ranked.find((item) => isDark(item)) ?? BRAND.navy;
  return {
    primary,
    accent,
    canvas,
    text,
    tableHeaderFill: primary,
    tableBodyFill: canvas,
    chartColors: uniqueHex([primary, accent, ...ranked]),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const ch = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `${ch(r)}${ch(g)}${ch(b)}`.toUpperCase();
}

function scoreMediaName(name: string): number {
  const lower = name.toLowerCase();
  if (lower.includes("logo")) return 0;
  if (lower.includes("header") || lower.includes("brand")) return 1;
  return 2;
}

function uniqueTexts(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function themeColor(scheme: string, name: string): string | undefined {
  const block = new RegExp(
    `<(?:a:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:a:)?${name}>`,
    "i",
  ).exec(scheme)?.[1];
  if (!block) return undefined;
  const srgb = /<(?:a:)?srgbClr\b[^>]*val="([0-9A-Fa-f]{6})"/i.exec(block)?.[1];
  if (srgb) return srgb.toUpperCase();
  const last = /<(?:a:)?sysClr\b[^>]*lastClr="([0-9A-Fa-f]{6})"/i.exec(block)?.[1];
  return last?.toUpperCase();
}

function hex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace("#", "").trim();
  if (!/^[0-9A-Fa-f]{6}$/.test(cleaned)) return undefined;
  return cleaned.toUpperCase();
}

function normalizeHex(value: string): string {
  return (hex(value) ?? BRAND.navy).toUpperCase();
}

function uniqueHex(values: string[]): string[] {
  return [...new Set(values.map((item) => normalizeHex(item)))];
}

function isNearBlack(value: string): boolean {
  const n = Number.parseInt(normalizeHex(value), 16);
  return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255) < 40;
}

function isNearWhite(value: string): boolean {
  const n = Number.parseInt(normalizeHex(value), 16);
  return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255) > 720;
}

function isDark(value: string): boolean {
  const n = Number.parseInt(normalizeHex(value), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return r * 0.299 + g * 0.587 + b * 0.114 < 140;
}

function mix(a: string, b: string, amount: number): string {
  const pa = hexRgb(a);
  const pb = hexRgb(b);
  const ch = (left: number, right: number) =>
    Math.round((left * (1 - amount) + right * amount) * 255)
      .toString(16)
      .padStart(2, "0");
  return `${ch(pa.r, pb.r)}${ch(pa.g, pb.g)}${ch(pa.b, pb.b)}`.toUpperCase();
}
