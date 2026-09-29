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
};

const COPY_LINES = 6;
const CARD_ITEMS = 4;
const STAT_ITEMS = 4;
const TABLE_ROWS = 6;
const TIMELINE_ITEMS = 5;

export function planSlides(spec: DocumentSpec): PlannedSlide[] {
  const slides: PlannedSlide[] = [];
  for (const section of spec.sections) {
    slides.push(...slidesFor(section));
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

export function resolveLayout(section: DocSection): SlideLayout {
  const explicit = section.layout && section.layout !== "auto" ? section.layout : asLayout(section.layout);
  if (explicit && explicit !== "auto") return explicit;
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

function paginate(section: DocSection, layout: SlideLayout): PlannedSlide[] {
  if (layout === "copy") return chunkLines(section, COPY_LINES, "copy");
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
    const extra = linesOf(section).slice(2);
    const slides: PlannedSlide[] = [{ layout: "image", section, continuation: false }];
    if (extra.length) {
      slides.push(
        ...chunkLines(
          { ...section, body: extra, bullets: [], numbered: undefined, chart: undefined, table: undefined },
          COPY_LINES,
          "copy",
        ),
      );
    }
    return slides;
  }
  if (layout === "chart") {
    const side = linesOf(section).slice(0, 6);
    const rest = linesOf(section).slice(6);
    const slides: PlannedSlide[] = [
      {
        layout: "chart",
        continuation: false,
        section: { ...section, body: side, bullets: [], numbered: undefined },
      },
    ];
    if (rest.length) {
      slides.push(
        ...chunkLines(
          { ...section, body: rest, bullets: [], numbered: undefined, chart: undefined, table: undefined },
          COPY_LINES,
          "copy",
        ),
      );
    }
    return slides;
  }
  if (layout === "table" && section.table) {
    const rows = section.table.rows;
    if (rows.length <= TABLE_ROWS) return [{ layout: "table", section, continuation: false }];
    const slides: PlannedSlide[] = [];
    for (let index = 0; index < rows.length; index += TABLE_ROWS) {
      slides.push({
        layout: "table",
        continuation: index > 0,
        section: {
          ...section,
          table: { headers: section.table.headers, rows: rows.slice(index, index + TABLE_ROWS) },
        },
      });
    }
    return slides;
  }
  return chunkLines(section, COPY_LINES, "copy");
}

function chunkLines(section: DocSection, size: number, layout: SlideLayout): PlannedSlide[] {
  const lines = linesOf(section);
  if (lines.length <= size) return [{ layout, section, continuation: false }];
  const slides: PlannedSlide[] = [];
  for (let index = 0; index < lines.length; index += size) {
    const slice = lines.slice(index, index + size);
    slides.push({
      layout,
      continuation: index > 0,
      section: { ...section, body: slice, bullets: [], numbered: undefined, table: undefined, chart: undefined },
    });
  }
  return slides;
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
