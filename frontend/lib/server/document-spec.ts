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

export type SectionLayout =
  | "auto"
  | "copy"
  | "cards"
  | "stats"
  | "table"
  | "chart"
  | "timeline"
  | "compare"
  | "quote"
  | "divider"
  | "image";

export type SlideRatio = "16:9" | "16:10" | "4:3";

export type DocKpi = {
  value: string;
  label: string;
};

export type DocSection = {
  title: string;
  level?: 1 | 2 | 3;
  body: string[];
  bullets: string[];
  bulletDepth?: number[];
  numbered?: string[];
  table?: DocTable;
  chart?: DocChart;
  layout?: SectionLayout;
  quote?: string;
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
  couverture?: boolean;
  conclusion?: boolean;
  motif?: boolean;
  ratio?: SlideRatio;
  signature?: string;
  marque?: string;
};

export type DocumentSpec = {
  title: string;
  subtitle: string;
  sections: DocSection[];
  charts: DocChart[];
  kpis?: DocKpi[];
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
  | { type: "list"; items: string[]; ordered: boolean; depths: number[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "code"; text: string };

export function specFromMarkdown(markdown: string, question: string): DocumentSpec {
  const prose = specFromBlocks(parseBlocks(markdown), question);
  const fromJson = parseSpecFence(markdown);
  if (!fromJson) return prose;
  return mergeVisibleAnswer(fromJson, prose);
}

/** La réponse affichée dans le chat est le document. Un fence de design ne la remplace pas. */
function mergeVisibleAnswer(fence: DocumentSpec, prose: DocumentSpec): DocumentSpec {
  const fenceWeight = specTextWeight(fence);
  const proseWeight = specTextWeight(prose);
  if (proseWeight >= Math.max(80, fenceWeight)) {
    return {
      ...prose,
      title: usefulTitle(fence.title) ? fence.title : prose.title,
      subtitle: fence.subtitle || prose.subtitle,
      charts: prose.charts.length ? prose.charts : fence.charts,
      kpis: prose.kpis?.length ? prose.kpis : fence.kpis,
      design: fence.design ?? prose.design,
    };
  }
  const byTitle = new Map(prose.sections.map((section) => [normTitle(section.title), section]));
  const sections = fence.sections.map((section) => {
    if (sectionTextWeight(section) > 40) return section;
    const match = byTitle.get(normTitle(section.title));
    if (!match || sectionTextWeight(match) <= sectionTextWeight(section)) return section;
    return {
      ...section,
      body: section.body.length ? section.body : match.body,
      bullets: section.bullets.length ? section.bullets : match.bullets,
      bulletDepth: section.bullets.length ? section.bulletDepth : match.bulletDepth,
      numbered: section.numbered?.length ? section.numbered : match.numbered,
      table: section.table ?? match.table,
      chart: section.chart ?? match.chart,
      quote: section.quote ?? match.quote,
    };
  });
  const filled = specTextWeight({ ...fence, sections });
  if (proseWeight > filled) {
    return {
      ...prose,
      title: usefulTitle(fence.title) ? fence.title : prose.title,
      subtitle: fence.subtitle || prose.subtitle,
      design: fence.design ?? prose.design,
      kpis: fence.kpis ?? prose.kpis,
    };
  }
  return { ...fence, sections };
}

function usefulTitle(title: string): boolean {
  const text = title.trim();
  return Boolean(text) && text !== "Ubuntu IA" && text !== "Synthèse";
}

function normTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function specTextWeight(spec: DocumentSpec): number {
  return spec.sections.reduce((sum, section) => sum + sectionTextWeight(section), 0);
}

function sectionTextWeight(section: DocSection): number {
  const table = section.table ? section.table.rows.flat().join(" ").length : 0;
  return (
    section.body.join(" ").length +
    section.bullets.join(" ").length +
    (section.numbered ?? []).join(" ").length +
    (section.quote?.length ?? 0) +
    table
  );
}

function parseSpecFence(markdown: string): DocumentSpec | null {
  const matches = [...markdown.matchAll(/```(?:ubuntu-ia-doc|json)\s*([\s\S]*?)```/gi)];
  let best: DocumentSpec | null = null;
  let bestWeight = -1;
  for (const match of matches) {
    const spec = specFromFenceBody(match[1] ?? "");
    if (!spec) continue;
    const weight = specTextWeight(spec) + (spec.sections.length > 0 ? 1 : 0);
    if (weight > bestWeight) {
      best = spec;
      bestWeight = weight;
    }
  }
  return best;
}

function specFromFenceBody(body: string): DocumentSpec | null {
  try {
    const raw = JSON.parse(body) as Record<string, unknown>;
    const title = String(raw.titre ?? raw.title ?? "").trim();
    const sectionSource = raw.sections ?? raw.parties ?? raw.chapitres;
    const parsedSections =
      typeof sectionSource === "string"
        ? specFromBlocks(parseBlocks(sectionSource), title || "Document").sections
        : Array.isArray(sectionSource)
          ? sectionSource.flatMap((item) => sectionsFromUnknown(item))
          : [];
    if (!title && !parsedSections.length && !asDesign(raw.design ?? raw.miseEnForme)) return null;
    const charts = Array.isArray(raw.graphes)
      ? raw.graphes
      : Array.isArray(raw.charts)
        ? raw.charts
        : [];
    const parsedCharts = charts
      .map((item) => asChart(item))
      .filter((item): item is DocChart => Boolean(item));
    return {
      title: title || "Ubuntu IA",
      subtitle: String(raw.sousTitre ?? raw.subtitle ?? raw.chapo ?? "").trim(),
      sections: parsedSections,
      charts: parsedCharts,
      kpis: asKpis(raw.indicateurs ?? raw.kpis),
      design: asDesign(raw.design ?? raw.miseEnForme),
    };
  } catch {
    return null;
  }
}

function sectionsFromUnknown(value: unknown): DocSection[] {
  const section = asSection(value);
  if (!section || !value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const nested = row.sousSections ?? row.sous_sections ?? row.children ?? row.sections;
  const children = Array.isArray(nested) ? nested.flatMap((item) => sectionsFromUnknown(item)) : [];
  return [section, ...children];
}

function asSection(value: unknown): DocSection | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const title = String(row.titre ?? row.title ?? row.nom ?? "").trim();
  const prose = row.contenu ?? row.content ?? row.texte ?? row.text ?? row.description ?? row.paragraphes;
  const fromBody = stringList(row.body);
  const body = fromBody.length ? fromBody : stringList(prose);
  const bullets = [
    ...stringList(row.puces ?? row.bullets ?? row.points ?? row.items ?? row.liste),
  ].map((item) => item.replace(/^[-*]\s+/, ""));
  const numbered = stringList(row.numerotation ?? row.numbered);
  const table = asTable(row.tableau ?? row.table);
  const chart = asChart(row.graphe ?? row.chart) ?? undefined;
  const quote = String(row.citation ?? row.quote ?? "").trim();
  const layout = asLayout(row.miseEnPage ?? row.layout);
  const level = asLevel(row.niveau ?? row.level);
  if (!title && !body.length && !bullets.length && !numbered.length && !table && !chart && !quote) return null;
  return {
    title: title || "Section",
    level,
    body,
    bullets,
    numbered: numbered.length ? numbered : undefined,
    table,
    chart,
    layout,
    quote: quote || undefined,
  };
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return item.trim() ? [item.trim()] : [];
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const text = String(row.texte ?? row.text ?? row.contenu ?? row.content ?? row.paragraphe ?? row.libelle ?? "").trim();
    return text ? [text] : [];
  });
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
    couverture: asBool(row.couverture ?? row.cover),
    conclusion: asBool(row.conclusion ?? row.close),
    motif: asBool(row.motif ?? row.ornement),
    ratio: asRatio(row.ratio ?? row.format),
    signature: textOrUndefined(row.signature),
    marque: textOrUndefined(row.marque ?? row.eyebrow),
  };
  return Object.values(design).some((item) => item !== undefined) ? design : undefined;
}

function asKpis(value: unknown): DocKpi[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kpis = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const label = String(row.libelle ?? row.label ?? "").trim();
      const amount = String(row.valeur ?? row.value ?? "").trim();
      if (!label || !amount) return null;
      return { value: amount, label };
    })
    .filter((item): item is DocKpi => Boolean(item));
  return kpis.length ? kpis : undefined;
}

function asBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "oui" || value === 1) return true;
  if (value === "false" || value === "non" || value === 0) return false;
  return undefined;
}

function asRatio(value: unknown): SlideRatio | undefined {
  const text = String(value ?? "").toLowerCase().replace(/\s/g, "");
  if (text === "16:9" || text === "16x9") return "16:9";
  if (text === "16:10" || text === "16x10") return "16:10";
  if (text === "4:3" || text === "4x3") return "4:3";
  return undefined;
}

function asLevel(value: unknown): 1 | 2 | 3 | undefined {
  const n = Number(value);
  if (n === 1 || n === 2 || n === 3) return n;
  return undefined;
}

export function asLayout(value: unknown): SectionLayout | undefined {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const map: Record<string, SectionLayout> = {
    auto: "auto",
    copy: "copy",
    texte: "copy",
    cards: "cards",
    cartes: "cards",
    stats: "stats",
    chiffres: "stats",
    kpi: "stats",
    table: "table",
    tableau: "table",
    chart: "chart",
    graphe: "chart",
    graphique: "chart",
    timeline: "timeline",
    frise: "timeline",
    chronologie: "timeline",
    compare: "compare",
    comparaison: "compare",
    versus: "compare",
    quote: "quote",
    citation: "quote",
    divider: "divider",
    separateur: "divider",
    section: "divider",
    image: "image",
    visuel: "image",
    photo: "image",
  };
  return map[text];
}

function textOrUndefined(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
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
  let current: DocSection = { title: "Synthèse", level: 1, body: [], bullets: [] };

  const push = () => {
    if (
      current.title ||
      current.body.length ||
      current.bullets.length ||
      current.numbered?.length ||
      current.table ||
      current.chart
    ) {
      sections.push(current);
    }
  };

  for (const block of blocks) {
    if (block.type === "h") {
      if (block.text === title && !sections.length && !current.body.length && !current.bullets.length) continue;
      push();
      current = { title: block.text, level: block.level, body: [], bullets: [] };
    } else if (block.type === "p") {
      current.body.push(block.text);
    } else if (block.type === "list") {
      if (block.ordered) {
        current.numbered = [...(current.numbered ?? []), ...block.items];
      } else {
        const start = current.bullets.length;
        current.bullets.push(...block.items);
        const depths = current.bulletDepth ? [...current.bulletDepth] : Array.from({ length: start }, () => 0);
        current.bulletDepth = [...depths, ...block.depths];
      }
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
  let list: { text: string; depth: number }[] = [];
  let listOrdered = false;
  let code: string[] | null = null;
  let skipFence = false;

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (text) blocks.push({ type: "p", text: stripInline(text) });
  };
  const flushList = () => {
    if (list.length) {
      blocks.push({
        type: "list",
        ordered: listOrdered,
        items: list.map((item) => stripInline(item.text)),
        depths: list.map((item) => item.depth),
      });
    }
    list = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    if (code) {
      if (line.trim().startsWith("```")) {
        const body = code.join("\n");
        if (!skipFence && body.trim() && !specFromFenceBody(body)) blocks.push({ type: "code", text: body });
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
    const bullet = /^(\s*)[-*]\s+(.+)$/.exec(line);
    const ordered = /^(\s*)\d+[.)]\s+(.+)$/.exec(line);
    if (bullet || ordered) {
      const orderedLine = Boolean(ordered && !bullet);
      if (list.length && orderedLine !== listOrdered) flushList();
      flushParagraph();
      listOrdered = orderedLine;
      const match = (bullet ?? ordered)!;
      const depth = match[1].replace(/\t/g, "  ").length >= 2 ? 1 : 0;
      list.push({ text: match[2], depth });
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
  if (blocks.length) return blocks;
  const outside = markdown.replace(/```(?:ubuntu-ia-doc|json)\s*[\s\S]*?```/gi, " ").trim();
  return outside ? [{ type: "p", text: stripInline(outside) }] : [];
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
    .replace(/\s+/g, " ")
    .trim();
}

export function plainFromSpec(spec: DocumentSpec): string {
  const parts = [spec.title, spec.subtitle];
  for (const section of spec.sections) {
    parts.push(
      section.title,
      ...section.body,
      ...section.bullets.map((item) => `- ${item}`),
      ...(section.numbered ?? []).map((item, index) => `${index + 1}. ${item}`),
      section.quote ?? "",
    );
  }
  return parts.filter(Boolean).join("\n\n");
}
