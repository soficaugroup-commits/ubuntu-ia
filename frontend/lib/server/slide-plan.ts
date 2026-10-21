import {
  asLayout,
  type DocSection,
  type DocumentSpec,
  type SectionLayout,
} from "@/lib/server/document-spec";

export type SlideLayout = Exclude<SectionLayout, "auto">;

export type PlannedSlide = {
  layout: SlideLayout;
  section: DocSection;
  continuation: boolean;
  /** Texte destiné aux notes de l'orateur (détail retiré de la diapo). */
  notes?: string;
};

/** Zone de texte en pouces et taille de police en points, pour estimer la hauteur occupée. */
export type TextBox = { w: number; h: number; font: number; after: number };

/** Au plus ~6 lignes par diapo, et jamais plus que ce que la zone peut afficher. */
export const MAX_LINES_PER_SLIDE = 6;
const CARD_ITEMS = 4;
const STAT_ITEMS = 4;
const TABLE_ROWS = 6;
const TIMELINE_ITEMS = 5;

/** Zones du gabarit 16:9 (le plus contraint en hauteur) utilisées par `generate-chat-pptx.ts`. */
export const BOXES = {
  copy: { w: 9.1, h: 3.85, font: 16, after: 10 },
  chartSide: { w: 3.9, h: 3.9, font: 14, after: 8 },
  card: { w: 3.6, h: 1.5, font: 14, after: 0 },
  timeline: { w: 8.3, h: 0.62, font: 16, after: 0 },
  quote: { w: 8.5, h: 2.5, font: 22, after: 0 },
  table: { w: 9.1, h: 3.9, font: 12, after: 0 },
  title: { w: 8.5, h: 0.8, font: 26, after: 0 },
} as const satisfies Record<string, TextBox>;

/** Largeur moyenne d'un caractère rapportée à la taille de police (Calibri ≈ 0,5). */
const CHAR_WIDTH = 0.5;
const LINE_HEIGHT = 1.2;

export function estimateLines(text: string, widthIn: number, fontPt: number): number {
  const perLine = Math.max(1, Math.floor((widthIn * 72) / (fontPt * CHAR_WIDTH)));
  return Math.max(1, Math.ceil(text.trim().length / perLine));
}

export function estimateHeight(items: string[], box: TextBox): number {
  return items.reduce(
    (sum, item) => sum + (estimateLines(item, box.w, box.font) * box.font * LINE_HEIGHT + box.after) / 72,
    0,
  );
}

export function fits(items: string[], box: TextBox): boolean {
  return estimateHeight(items, box) <= box.h;
}

/** Titre de diapo sur au plus deux lignes : taille réduite si besoin, sinon tronqué (titre complet en notes). */
export function fitTitle(title: string, box: TextBox = BOXES.title): { text: string; font: number; truncated: boolean } {
  for (const font of [box.font, 22, 20]) {
    if (estimateLines(title, box.w, font) <= 2) return { text: title, font, truncated: false };
  }
  const font = 20;
  const max = Math.floor((box.w * 72) / (font * CHAR_WIDTH)) * 2 - 1;
  return { text: `${title.slice(0, max).trimEnd()}…`, font, truncated: true };
}

export function planSlides(spec: DocumentSpec): PlannedSlide[] {
  const slides: PlannedSlide[] = [];
  for (const section of spec.sections) {
    slides.push(...withNotes(section, slidesFor(section)));
  }
  return slides.length ? slides : [{ layout: "copy", section: { title: spec.title, body: [spec.subtitle], bullets: [] }, continuation: false }];
}

export function withLiteralLayouts(spec: DocumentSpec): DocumentSpec {
  return {
    ...spec,
    sections: spec.sections.map((section) => ({
      ...section,
      layout: section.chart ? "chart" : section.table ? "table" : "copy",
    })),
  };
}

function slidesFor(section: DocSection): PlannedSlide[] {
  const layout = resolveLayout(section);
  const main = paginate(section, layout);
  const extras: PlannedSlide[] = [];
  if (section.chart && layout !== "chart") {
    extras.push(
      ...paginate(
        { ...section, body: [], bullets: [], numbered: undefined, quote: undefined },
        "chart",
      ),
    );
  }
  if (section.table && layout !== "table" && layout !== "compare") {
    extras.push(
      ...paginate(
        { ...section, body: [], bullets: [], numbered: undefined, quote: undefined, chart: undefined },
        "table",
      ),
    );
  }
  return [...main, ...extras];
}

/** Notes : texte complet de la diapo + tout ce que la section contient sans être affiché. */
function withNotes(section: DocSection, slides: PlannedSlide[]): PlannedSlide[] {
  const shown = new Set(slides.flatMap((slide) => shownLines(slide)));
  const missing = linesOf(section).filter((line) => !shown.has(line));
  return slides.map((slide, index) => {
    const parts = [...shownLines(slide)];
    if (index === 0 && missing.length) parts.push("Détail non affiché :", ...missing.map((line) => `- ${line}`));
    if (fitTitle(section.title).truncated) parts.unshift(`Titre complet : ${section.title}`);
    return parts.length ? { ...slide, notes: parts.join("\n") } : slide;
  });
}

/** Lignes réellement affichées par le gabarit (miroir des fonctions `add*Slide`). */
export function shownLines(slide: PlannedSlide): string[] {
  const section = slide.section;
  switch (slide.layout) {
    case "copy":
    case "image":
    case "chart":
      return linesOf(section);
    case "cards":
      return section.bullets.slice(0, CARD_ITEMS);
    case "timeline":
      return (section.bullets.length ? section.bullets : linesOf(section)).slice(0, TIMELINE_ITEMS);
    case "stats":
      return section.bullets.slice(0, STAT_ITEMS);
    case "quote":
      return [section.quote || section.body[0] || section.bullets[0] || ""].filter(Boolean);
    case "divider":
      return [section.body[0] || section.quote || ""].filter(Boolean);
    case "compare":
      return section.table ? [] : linesOf(section);
    default:
      return [];
  }
}

export function resolveLayout(section: DocSection): SlideLayout {
  const explicit = section.layout && section.layout !== "auto" ? section.layout : asLayout(section.layout);
  const wanted = explicit && explicit !== "auto" ? explicit : inferLayout(section);
  return layoutFits(section, wanted) ? wanted : section.table ? "table" : "copy";
}

function inferLayout(section: DocSection): SlideLayout {
  if (section.quote) return "quote";
  if (section.chart) return "chart";
  if (section.table && looksLikeCompare(section)) return "compare";
  if (section.table) return "table";
  if (looksLikeTimeline(section)) return "timeline";
  if (looksLikeCompare(section)) return "compare";
  const stats = statLines(section);
  if (stats.length >= 2 && linesOf(section).length <= 6) return "stats";
  if (section.bullets.length >= 3 && section.body.length === 0 && !section.numbered?.length) return "cards";
  return "copy";
}

/** Un gabarit à cases fixes ne doit jamais recevoir un texte qui déborde de sa case. */
function layoutFits(section: DocSection, layout: SlideLayout): boolean {
  if (layout === "cards") return section.bullets.every((item) => fits([item], BOXES.card));
  if (layout === "timeline") {
    const items = [...(section.numbered ?? []), ...section.bullets, ...section.body];
    return items.every((item) => estimateLines(item, BOXES.timeline.w, BOXES.timeline.font) <= 2);
  }
  if (layout === "quote") {
    const text = section.quote || section.body[0] || section.bullets[0] || section.title;
    return fits([text], BOXES.quote);
  }
  if (layout === "compare" && !section.table) {
    const half = { ...BOXES.copy, w: BOXES.copy.w / 2 - 0.2 };
    const items = linesOf(section);
    const mid = Math.ceil(items.length / 2);
    return fits(items.slice(0, mid), half) && fits(items.slice(mid), half);
  }
  return true;
}

function paginate(section: DocSection, layout: SlideLayout): PlannedSlide[] {
  if (layout === "copy") return chunkLines(section, BOXES.copy, "copy");
  if (layout === "cards") return chunkItems({ ...section, body: [] }, section.bullets, CARD_ITEMS, "cards");
  if (layout === "stats") {
    return chunkItems(
      { ...section, body: [], numbered: undefined },
      statLines(section).map((item) => `${item.value} ${item.label}`),
      STAT_ITEMS,
      "stats",
    );
  }
  if (layout === "timeline") {
    const items = [...(section.numbered ?? []), ...section.bullets, ...section.body];
    return chunkItems({ ...section, body: [], numbered: undefined }, items, TIMELINE_ITEMS, "timeline");
  }
  if (layout === "quote" || layout === "divider" || layout === "compare") {
    return [{ layout, section, continuation: false }];
  }
  if (layout === "image") {
    const groups = groupByHeight(linesOf(section), { ...BOXES.chartSide, w: 3.9 });
    const slides: PlannedSlide[] = [
      { layout: "image", section: { ...section, body: groups[0] ?? [], bullets: [], numbered: undefined }, continuation: false },
    ];
    const rest = groups.slice(1).flat();
    if (rest.length) slides.push(...chunkLines(copyOnly(section, rest), BOXES.copy, "copy"));
    return slides;
  }
  if (layout === "chart") {
    const groups = groupByHeight(linesOf(section), BOXES.chartSide);
    const slides: PlannedSlide[] = [
      {
        layout: "chart",
        continuation: false,
        section: { ...section, body: groups[0] ?? [], bullets: [], numbered: undefined },
      },
    ];
    const rest = groups.slice(1).flat();
    if (rest.length) slides.push(...chunkLines(copyOnly(section, rest), BOXES.copy, "copy"));
    return slides;
  }
  if (layout === "table" && section.table) {
    return chunkTable(section);
  }
  return chunkLines(section, BOXES.copy, "copy");
}

function copyOnly(section: DocSection, lines: string[]): DocSection {
  return { ...section, body: lines, bullets: [], numbered: undefined, chart: undefined, table: undefined };
}

/** Regroupe des lignes par diapo : au plus 6 lignes et une hauteur estimée qui tient dans la zone. */
export function groupByHeight(lines: string[], box: TextBox, maxItems = MAX_LINES_PER_SLIDE): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  for (const line of lines.flatMap((item) => splitOversized(item, box))) {
    const next = [...current, line];
    if (current.length && (next.length > maxItems || !fits(next, box))) {
      groups.push(current);
      current = [line];
    } else {
      current = next;
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

/** Un paragraphe trop long pour une diapo entière est coupé aux fins de phrase. */
function splitOversized(text: string, box: TextBox): string[] {
  if (fits([text], box)) return [text];
  const sentences = text.match(/[^.!?;]+[.!?;]*\s*/g)?.map((item) => item.trim()).filter(Boolean) ?? [text];
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (current && !fits([next], box)) {
      parts.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts.flatMap((part) => (fits([part], box) ? [part] : hardSplit(part, box)));
}

function hardSplit(text: string, box: TextBox): string[] {
  const perLine = Math.max(1, Math.floor((box.w * 72) / (box.font * CHAR_WIDTH)));
  const linesPerBox = Math.max(1, Math.floor((box.h * 72) / (box.font * LINE_HEIGHT)) - 1);
  const size = perLine * linesPerBox;
  const words = text.split(/\s+/);
  const parts: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > size) {
      parts.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function chunkLines(section: DocSection, box: TextBox, layout: SlideLayout): PlannedSlide[] {
  const lines = linesOf(section);
  const groups = groupByHeight(lines, box);
  if (groups.length <= 1 && lines.length <= MAX_LINES_PER_SLIDE && fits(lines, box)) {
    return [{ layout, section, continuation: false }];
  }
  return groups.map((slice, index) => ({
    layout,
    continuation: index > 0,
    section: copyOnly(section, slice),
  }));
}

function chunkTable(section: DocSection): PlannedSlide[] {
  const table = section.table!;
  const box = BOXES.table;
  const colW = box.w / Math.max(1, table.headers.length);
  const rowHeight = (row: string[]) =>
    (Math.max(1, ...row.map((cell) => estimateLines(cell, colW - 0.1, box.font))) * box.font * LINE_HEIGHT) / 72 + 0.12;
  const available = box.h - rowHeight(table.headers);
  const pages: string[][][] = [];
  let current: string[][] = [];
  let used = 0;
  for (const row of table.rows) {
    const height = rowHeight(row);
    if (current.length && (current.length >= TABLE_ROWS || used + height > available)) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(row);
    used += height;
  }
  if (current.length) pages.push(current);
  if (pages.length <= 1) return [{ layout: "table", section, continuation: false }];
  return pages.map((rows, index) => ({
    layout: "table",
    continuation: index > 0,
    section: { ...section, table: { headers: table.headers, rows } },
  }));
}

function chunkItems(section: DocSection, items: string[], size: number, layout: SlideLayout): PlannedSlide[] {
  const source = items.length ? items : linesOf(section);
  if (!source.length) return [{ layout, section, continuation: false }];
  if (source.length <= size) {
    return [{ layout, section: { ...section, bullets: source, body: section.body.slice(0, 1) }, continuation: false }];
  }
  const slides: PlannedSlide[] = [];
  for (let index = 0; index < source.length; index += size) {
    slides.push({
      layout,
      continuation: index > 0,
      section: {
        ...section,
        bullets: source.slice(index, index + size),
        body: [],
        numbered: undefined,
      },
    });
  }
  return slides;
}

export function linesOf(section: DocSection): string[] {
  return [...section.body, ...section.bullets, ...(section.numbered ?? [])].filter(Boolean);
}

export function statLines(section: DocSection): { value: string; label: string }[] {
  const found: { value: string; label: string }[] = [];
  for (const line of linesOf(section)) {
    const match = line.match(/(-?\d+(?:[.,]\d+)?\s?%?)/);
    if (!match) continue;
    found.push({
      value: match[1].replace(/\s/g, ""),
      label: line.replace(match[1], "").replace(/^[\s:–—-]+/, "").slice(0, 80) || section.title,
    });
  }
  return found;
}

function looksLikeTimeline(section: DocSection): boolean {
  const items = [...(section.numbered ?? []), ...section.bullets];
  if (items.length < 3) return false;
  const hits = items.filter((item) => /^(?:\d{4}\b|étape|etape|phase|t\d+\b|j\+\d+)/i.test(item.trim())).length;
  return hits >= Math.ceil(items.length / 2);
}

function looksLikeCompare(section: DocSection): boolean {
  if (/compar|versus|\bvs\b|contre/i.test(section.title)) return true;
  if (section.table && section.table.headers.length >= 2 && section.table.headers.length <= 3) {
    return /compar|\bvs\b|contre|option/i.test(section.table.headers.join(" "));
  }
  return false;
}
