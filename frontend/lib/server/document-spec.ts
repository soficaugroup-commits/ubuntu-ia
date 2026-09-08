export type ChartKind = "bar" | "column" | "line" | "pie";

export type DocChart = {
  title: string;
  kind: ChartKind;
  categories: string[];
  series: { name: string; values: number[] }[];
};

export type DocTable = {
  headers: string[];
  rows: string[][];
};

export type DocSection = {
  title: string;
  body: string[];
  bullets: string[];
  table?: DocTable;
  chart?: DocChart;
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

export type DocumentSpec = {
  title: string;
  subtitle: string;
  sections: DocSection[];
  charts: DocChart[];
  design?: DocDesign;
};

export const BRAND = {
  navy: "17405B",
  gold: "AD8859",
  canvas: "E8EEF2",
  mid: "3D6A82",
  sand: "C4A574",
  white: "FFFFFF",
  chartColors: ["17405B", "AD8859", "3D6A82", "C4A574"],
} as const;

type MarkdownBlock =
  | { type: "h"; level: 1 | 2 | 3; text: string }
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "code"; text: string };

export function specFromMarkdown(markdown: string, question: string): DocumentSpec {
  const fromJson = parseSpecFence(markdown);
  if (fromJson) return fromJson;
  return specFromBlocks(parseBlocks(markdown), question);
}

function parseSpecFence(markdown: string): DocumentSpec | null {
  const fence = /```(?:ubuntu-ia-doc|json)\s*([\s\S]*?)```/i.exec(markdown);
  if (!fence?.[1]) return null;
  try {
    const raw = JSON.parse(fence[1]) as Record<string, unknown>;
    const title = String(raw.titre ?? raw.title ?? "").trim();
    const sections = Array.isArray(raw.sections) ? raw.sections : [];
    if (!title && !sections.length) return null;
    const charts = Array.isArray(raw.graphes)
      ? raw.graphes
      : Array.isArray(raw.charts)
        ? raw.charts
        : [];
    const parsedSections = sections
      .map((item) => asSection(item))
      .filter((item): item is DocSection => Boolean(item));
    const parsedCharts = charts
      .map((item) => asChart(item))
      .filter((item): item is DocChart => Boolean(item));
    return {
      title: title || "Ubuntu IA",
      subtitle: String(raw.sousTitre ?? raw.subtitle ?? "").trim(),
      sections: parsedSections,
      charts: parsedCharts,
      design: asDesign(raw.design ?? raw.miseEnForme),
    };
  } catch {
    return null;
  }
}

function asSection(value: unknown): DocSection | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const title = String(row.titre ?? row.title ?? "").trim();
  const body = Array.isArray(row.body)
    ? row.body.map((item) => String(item).trim()).filter(Boolean)
    : typeof row.body === "string"
      ? [row.body.trim()]
      : [];
  const bulletsRaw = row.puces ?? row.bullets;
  const bullets = Array.isArray(bulletsRaw)
    ? bulletsRaw.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const table = asTable(row.tableau ?? row.table);
  const chart = asChart(row.graphe ?? row.chart) ?? undefined;
  if (!title && !body.length && !bullets.length && !table) return null;
  return { title: title || "Section", body, bullets, table, chart };
}

function asTable(value: unknown): DocTable | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const headers = Array.isArray(row.headers) ? row.headers.map((item) => String(item)) : [];
  const rows = Array.isArray(row.rows)
    ? row.rows.map((line) => (Array.isArray(line) ? line.map((cell) => String(cell)) : []))
    : [];
  if (!headers.length || !rows.length) return undefined;
  return { headers, rows };
}

function asDesign(value: unknown): DocDesign | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const pick = (key: string) => {
    const text = String(row[key] ?? "").replace("#", "").trim();
    return /^[0-9A-Fa-f]{6}$/.test(text) ? text.toUpperCase() : undefined;
  };
  const design: DocDesign = {
    primaire: pick("primaire") ?? pick("primary"),
    accent: pick("accent"),
    fond: pick("fond") ?? pick("canvas"),
    texte: pick("texte") ?? pick("text"),
    policeTitre: typeof row.policeTitre === "string" ? row.policeTitre : typeof row.headingFont === "string" ? row.headingFont : undefined,
    policeCorps: typeof row.policeCorps === "string" ? row.policeCorps : typeof row.bodyFont === "string" ? row.bodyFont : undefined,
  };
  return Object.values(design).some(Boolean) ? design : undefined;
}

function asChart(value: unknown): DocChart | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const categories = Array.isArray(row.categories)
    ? row.categories.map((item) => String(item))
    : [];
  const seriesRaw = Array.isArray(row.series) ? row.series : [];
  const series = seriesRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const current = item as Record<string, unknown>;
      const valuesRaw = current.valeurs ?? current.values;
      const values = Array.isArray(valuesRaw)
        ? valuesRaw.map(toNumber).filter((n): n is number => n !== null)
        : [];
      if (!values.length) return null;
      return {
        name: String(current.nom ?? current.name ?? "Série"),
        values: values as number[],
      };
    })
    .filter((item): item is { name: string; values: number[] } => Boolean(item));
  if (!categories.length || !series.length) return null;
  const kind = asChartKind(row.type ?? row.kind);
  return {
    title: String(row.titre ?? row.title ?? "Indicateurs"),
    kind,
    categories,
    series,
  };
}

function asChartKind(value: unknown): ChartKind {
  if (value === "pie" || value === "camembert") return "pie";
  if (value === "line" || value === "courbe") return "line";
  if (value === "column" || value === "colonne") return "column";
  return "bar";
}

function specFromBlocks(blocks: MarkdownBlock[], question: string): DocumentSpec {
  const title =
    blocks.find((block) => block.type === "h")?.text ||
    question.replace(/\s+/g, " ").trim().slice(0, 80) ||
    "Ubuntu IA";
  const subtitle =
    blocks.find((block) => block.type === "p")?.text.slice(0, 160) ?? "";
  const sections: DocSection[] = [];
  let current: DocSection = { title: "Synthèse", body: [], bullets: [] };

  const push = () => {
    if (current.title || current.body.length || current.bullets.length || current.table) {
      sections.push(current);
    }
  };

  for (const block of blocks) {
    if (block.type === "h" && block.level <= 2) {
      if (block.text === title && !sections.length && !current.body.length) continue;
      push();
      current = { title: block.text, body: [], bullets: [] };
    } else if (block.type === "p") {
      current.body.push(block.text);
    } else if (block.type === "list") {
      current.bullets.push(...block.items);
    } else if (block.type === "table") {
      current.table = { headers: block.headers, rows: block.rows };
      current.chart = chartFromTable(current.title, block);
    } else if (block.type === "code") {
      current.body.push(block.text);
    }
  }
  push();

  const charts = sections
    .map((section) => section.chart)
    .filter((item): item is DocChart => Boolean(item));

  return {
    title,
    subtitle,
    sections: sections.length ? sections : [{ title: "Synthèse", body: [subtitle || title], bullets: [] }],
    charts,
  };
}

function chartFromTable(
  title: string,
  table: { headers: string[]; rows: string[][] },
): DocChart | undefined {
  if (table.headers.length < 2 || table.rows.length < 2) return undefined;
  const categories = table.rows.map((row) => row[0] || "").filter(Boolean);
  if (categories.length < 2) return undefined;
  const series = table.headers.slice(1).map((name, index) => {
    const values = table.rows.map((row) => toNumber(row[index + 1])).filter((n) => n !== null) as number[];
    return { name: name || `Série ${index + 1}`, values };
  }).filter((item) => item.values.length >= 2 && item.values.length === categories.length);
  if (!series.length) return undefined;
  const kind: ChartKind =
    series.length === 1 && categories.length <= 6 ? "pie" : series.length === 1 ? "bar" : "column";
  return { title, kind, categories, series };
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "")
    .replace(/\s/g, "")
    .replace("%", "")
    .replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

export function parseBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;
  let skipFence = false;

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (text) blocks.push({ type: "p", text: stripInline(text) });
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: "list", items: list.map(stripInline) });
    list = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    if (code) {
      if (line.trim().startsWith("```")) {
        const body = code.join("\n");
        if (!skipFence && body.trim()) blocks.push({ type: "code", text: body });
        code = null;
        skipFence = false;
      } else {
        code.push(line);
      }
      i += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushList();
      const lang = line.trim().slice(3).trim().toLowerCase();
      skipFence = lang === "ubuntu-ia-doc";
      code = [];
      i += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
      blocks.push({ type: "h", level, text: stripInline(heading[2]) });
      i += 1;
      continue;
    }
    if (/^\|.+\|$/.test(line.trim()) && i + 1 < lines.length && /^\|?\s*:?-/.test(lines[i + 1])) {
      flushParagraph();
      flushList();
      const headers = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }
    const item = /^\s*[-*]\s+(.+)$/.exec(line);
    if (item) {
      flushParagraph();
      list.push(item[1]);
      i += 1;
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      i += 1;
      continue;
    }
    flushList();
    paragraph.push(line.trim());
    i += 1;
  }
  flushParagraph();
  flushList();
  return blocks.length ? blocks : [{ type: "p", text: stripInline(markdown) }];
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => stripInline(cell.trim()));
}

export function stripInline(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function plainFromSpec(spec: DocumentSpec): string {
  const parts = [spec.title, spec.subtitle];
  for (const section of spec.sections) {
    parts.push(section.title, ...section.body, ...section.bullets.map((item) => `- ${item}`));
  }
  return parts.filter(Boolean).join("\n\n");
}
