import "server-only";
import PptxGenJS from "pptxgenjs";
import { defaultDna, fitLogo, pptFont, type DesignDna } from "@/lib/server/design-dna";
import { BRAND, type DocChart, type DocumentSpec, type DocSection, type SlideRatio } from "@/lib/server/document-spec";
import { parseInline, plainInline } from "@/lib/server/rich-text";
import { isLong } from "@/lib/server/document-process";
import { linesOf, planSlides, statLines, type PlannedSlide } from "@/lib/server/slide-plan";

type PptSlide = ReturnType<PptxGenJS["addSlide"]>;

export type SlideImage = { mime: string; bytes: Buffer };

type Chrome = {
  cover: boolean;
  close: boolean;
  motif: boolean;
  ratio: SlideRatio;
  eyebrow: string;
  signature: string;
  w: number;
  h: number;
};

const RATIO: Record<SlideRatio, { name: string; w: number; h: number }> = {
  "16:9": { name: "LAYOUT_16x9", w: 10, h: 5.625 },
  "16:10": { name: "LAYOUT_16x10", w: 10, h: 6.25 },
  "4:3": { name: "LAYOUT_4x3", w: 10, h: 7.5 },
};

export async function buildPptx(
  spec: DocumentSpec,
  dna: DesignDna = defaultDna(),
  options: { synthesized?: boolean; images?: SlideImage[] } = {},
): Promise<Uint8Array> {
  const theme = { ...dna, headingFont: pptFont(dna.headingFont), bodyFont: pptFont(dna.bodyFont) };
  const chrome = deckChrome(spec, theme);
  const deck = new PptxGenJS();
  deck.layout = RATIO[chrome.ratio].name;
  deck.author = "Ubuntu IA";
  deck.title = plainInline(spec.title);
  deck.subject = chrome.signature || "Ubuntu IA";

  if (chrome.cover) addCover(deck, spec, theme, chrome);
  if (isLong(spec)) addAgenda(deck, spec, theme, chrome);
  const slides = planSlides(spec).slice(0, 80);
  let imageUsed = false;
  for (const planned of slides) {
    addPlannedSlide(deck, planned, theme, chrome, options, imageUsed);
    if (planned.layout === "image") imageUsed = true;
  }
  if (chrome.close) addClose(deck, spec, theme, chrome);

  const output = await deck.write({ outputType: "nodebuffer" });
  return output instanceof Uint8Array ? output : new Uint8Array(output as ArrayBuffer);
}

function deckChrome(spec: DocumentSpec, theme: DesignDna): Chrome {
  const brand =
    theme.primary.toUpperCase() === BRAND.navy &&
    theme.accent.toUpperCase() === BRAND.gold &&
    !theme.headerLabel &&
    !theme.sourceName;
  const design = spec.design;
  const ratio = design?.ratio ?? "16:9";
  const size = RATIO[ratio];
  return {
    cover: design?.couverture !== false,
    close: design?.conclusion !== false,
    motif: design?.motif !== false,
    ratio,
    eyebrow: design?.marque?.trim() || theme.headerLabel?.trim() || (brand ? "UBUNTU IA" : ""),
    signature: design?.signature?.trim() || (brand ? "SOFICAU Ubuntu Group" : theme.sourceName || ""),
    w: size.w,
    h: size.h,
  };
}

function addCover(deck: PptxGenJS, spec: DocumentSpec, theme: DesignDna, chrome: Chrome) {
  const slide = deck.addSlide();
  slide.background = { color: theme.primary };
  if (chrome.motif) {
    goldOrb(slide, deck, theme, chrome.w - 2.4, -0.7, 3.2);
    goldOrb(slide, deck, theme, -0.9, chrome.h - 1.8, 2.1);
  }
  if (chrome.eyebrow) {
    slide.addText(chrome.eyebrow, {
      x: 0.6,
      y: chrome.h * 0.2,
      w: chrome.w - 1.4,
      h: 0.35,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 13,
      bold: true,
      color: theme.accent,
      charSpacing: 3,
    });
  }
  slide.addText(rich(spec.title, { fontFace: theme.headingFont, fontSize: 34, bold: true, color: theme.inverse }), {
    x: 0.6,
    y: chrome.h * 0.3,
    w: chrome.w - 1.6,
    h: 1.6,
    margin: 0,
    valign: "top",
  });
  if (spec.subtitle) {
    slide.addText(rich(spec.subtitle, { fontFace: theme.bodyFont, fontSize: 16, color: theme.muted }), {
      x: 0.6,
      y: chrome.h * 0.6,
      w: chrome.w - 1.8,
      h: 0.9,
      margin: 0,
    });
  }
  if (chrome.signature) {
    slide.addText(chrome.signature, {
      x: 0.6,
      y: chrome.h - 0.55,
      w: chrome.w - 2.4,
      h: 0.3,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 12,
      color: theme.accent,
    });
  }
  addLogo(slide, theme, chrome.w - 1.45, chrome.h - 0.68);
}

function addClose(deck: PptxGenJS, spec: DocumentSpec, theme: DesignDna, chrome: Chrome) {
  const slide = deck.addSlide();
  slide.background = { color: theme.primary };
  if (chrome.motif) goldOrb(slide, deck, theme, chrome.w - 1.9, chrome.h - 1.9, 2.4);
  slide.addText("Merci", {
    x: 0.6,
    y: chrome.h * 0.3,
    w: chrome.w - 1.5,
    h: 0.9,
    margin: 0,
    fontFace: theme.headingFont,
    fontSize: 40,
    bold: true,
    color: theme.inverse,
  });
  slide.addText(plainInline(spec.title), {
    x: 0.6,
    y: chrome.h * 0.48,
    w: chrome.w - 1.8,
    h: 0.7,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 16,
    color: theme.muted,
  });
  const credit = chrome.signature ? `Document généré par Ubuntu IA  ·  ${chrome.signature}` : "Document généré par Ubuntu IA";
  slide.addText(credit, {
    x: 0.6,
    y: chrome.h - 0.7,
    w: chrome.w - 1.5,
    h: 0.3,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 12,
    color: theme.accent,
  });
}

function addAgenda(deck: PptxGenJS, spec: DocumentSpec, theme: DesignDna, chrome: Chrome) {
  const titles = spec.sections.map((section) => plainInline(section.title)).filter(Boolean).slice(0, 8);
  if (titles.length < 2) return;
  const slide = deck.addSlide();
  slide.background = { color: theme.canvas };
  slide.addText("Plan", {
    x: 0.5,
    y: 0.35,
    w: chrome.w - 1,
    h: 0.5,
    fontFace: theme.headingFont,
    fontSize: 24,
    bold: true,
    color: theme.primary,
  });
  slide.addText(titles.map((title) => ({ text: title, options: { bullet: true, breakLine: true } })), {
    x: 0.6,
    y: 1.1,
    w: chrome.w - 1.2,
    h: chrome.h - 1.6,
    fontFace: theme.bodyFont,
    fontSize: 16,
    color: theme.text,
    paraSpaceAfter: 8,
  });
}

function addPlannedSlide(
  deck: PptxGenJS,
  planned: PlannedSlide,
  theme: DesignDna,
  chrome: Chrome,
  options: { synthesized?: boolean; images?: SlideImage[] },
  imageUsed: boolean,
) {
  const slide = deck.addSlide();
  const layout = planned.layout;
  if (layout === "divider") {
    addDivider(slide, deck, planned, theme, chrome);
    return;
  }
  slide.background = { color: theme.canvas };
  if (chrome.motif) goldOrb(slide, deck, theme, chrome.w - 0.85, -0.55, 1.4);
  addLogo(slide, theme, chrome.w - 0.95, chrome.h - 0.48);
  if (options.synthesized) {
    slide.addText("Contenu synthétisé pour le format diapositive.", {
      x: 0.45,
      y: chrome.h - 0.34,
      w: chrome.w - 2.2,
      h: 0.22,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 9,
      color: theme.muted,
    });
  }
  addTitle(slide, planned, theme, chrome);
  const section = planned.section;
  if (layout === "chart" && section.chart) addChartSlide(slide, deck, section, theme, chrome);
  else if (layout === "table" && section.table) addTableSlide(slide, section, theme, chrome);
  else if (layout === "stats") addStatSlide(slide, deck, section, theme, chrome);
  else if (layout === "cards") addCardGrid(slide, deck, section, theme, chrome);
  else if (layout === "timeline") addTimeline(slide, deck, section, theme, chrome);
  else if (layout === "compare") addCompare(slide, section, theme, chrome);
  else if (layout === "quote") addQuote(slide, section, theme, chrome);
  else if (layout === "image") addImageSlide(slide, section, theme, chrome, imageUsed ? undefined : options.images?.[0]);
  else addCopySlide(slide, section, theme, chrome);
}

function addTitle(slide: PptSlide, planned: PlannedSlide, theme: DesignDna, chrome: Chrome) {
  const title = planned.continuation ? `${plainInline(planned.section.title)} (suite)` : plainInline(planned.section.title);
  slide.addText(title, {
    x: 0.45,
    y: 0.28,
    w: chrome.w - 1.5,
    h: 0.62,
    margin: 0,
    fontFace: theme.headingFont,
    fontSize: planned.section.level === 3 ? 22 : 26,
    bold: true,
    color: theme.primary,
  });
}

function addDivider(slide: PptSlide, deck: PptxGenJS, planned: PlannedSlide, theme: DesignDna, chrome: Chrome) {
  slide.background = { color: theme.primary };
  if (chrome.motif) goldOrb(slide, deck, theme, chrome.w - 2.2, chrome.h - 1.6, 2.2);
  slide.addText(plainInline(planned.section.title), {
    x: 0.7,
    y: chrome.h * 0.35,
    w: chrome.w - 1.6,
    h: 1.4,
    margin: 0,
    fontFace: theme.headingFont,
    fontSize: 36,
    bold: true,
    color: theme.inverse,
  });
  const note = planned.section.body[0] || planned.section.quote;
  if (note) {
    slide.addText(note, {
      x: 0.7,
      y: chrome.h * 0.62,
      w: chrome.w - 1.8,
      h: 0.6,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 16,
      color: theme.accent,
    });
  }
}

function addChartSlide(slide: PptSlide, deck: PptxGenJS, section: DocSection, theme: DesignDna, chrome: Chrome) {
  const chart = section.chart as DocChart;
  const hasCopy = linesOf(section).length > 0;
  const chartX = hasCopy ? chrome.w * 0.46 : 0.45;
  const chartW = hasCopy ? chrome.w - chartX - 0.4 : chrome.w - 0.9;
  if (hasCopy) {
    slide.addText(asBullets(linesOf(section).slice(0, 6), false), {
      x: 0.45,
      y: 1.05,
      w: chartX - 0.7,
      h: chrome.h - 1.7,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 14,
      color: theme.primary,
      paraSpaceAfter: 8,
      valign: "top",
    });
  }
  const data = chart.series.map((series) => ({
    name: series.name,
    labels: chart.categories,
    values: series.values,
  }));
  const type =
    chart.kind === "pie" ? deck.ChartType.pie : chart.kind === "line" ? deck.ChartType.line : deck.ChartType.bar;
  slide.addChart(type, data, {
    x: chartX,
    y: 1.05,
    w: chartW,
    h: chrome.h - 1.7,
    barDir: chart.kind === "bar" ? "bar" : "col",
    showTitle: true,
    title: chart.title,
    showValue: chart.kind !== "pie",
    showPercent: chart.kind === "pie",
    dataLabelPosition: chart.kind === "pie" ? "bestFit" : "outEnd",
    dataLabelColor: theme.primary,
    dataLabelFontSize: 10,
    chartColors: [...theme.chartColors],
    showLegend: chart.kind === "pie" || chart.series.length > 1,
    legendPos: "b",
    chartArea: { fill: { color: theme.inverse } },
    catAxisLabelColor: theme.primary,
    valAxisLabelColor: theme.primary,
    catGridLine: { style: "none" },
    valGridLine: { color: "C5D0D6", size: 0.5 },
    showValAxisTitle: false,
    showCatAxisTitle: false,
  });
}

function addTableSlide(slide: PptSlide, section: DocSection, theme: DesignDna, chrome: Chrome) {
  const table = section.table;
  if (!table) return;
  const header = table.headers.map((cell) => ({
    text: plainInline(cell),
    options: {
      fill: { color: theme.tableHeaderFill },
      color: theme.inverse,
      bold: true,
      align: "center" as const,
      valign: "middle" as const,
    },
  }));
  const rows = table.rows.map((row, rowIndex) =>
    table.headers.map((_, index) => ({
      text: plainInline(row[index] ?? ""),
      options: {
        fill: { color: theme.zebra && rowIndex % 2 === 1 ? theme.tableBodyFill : theme.inverse },
        color: theme.primary,
        align: "left" as const,
      },
    })),
  );
  const width = chrome.w - 0.9;
  slide.addTable([header, ...rows], {
    x: 0.45,
    y: 1.05,
    w: width,
    h: chrome.h - 1.7,
    colW: table.headers.map(() => width / Math.max(1, table.headers.length)),
    border: [
      { pt: 0, color: theme.canvas },
      { pt: 0, color: theme.canvas },
      { pt: 0, color: theme.canvas },
      { pt: 0, color: theme.canvas },
    ],
    fontFace: theme.bodyFont,
    fontSize: table.headers.length > 6 ? 11 : 13,
    valign: "middle",
  });
}

function addStatSlide(slide: PptSlide, deck: PptxGenJS, section: DocSection, theme: DesignDna, chrome: Chrome) {
  const shown = statLines(section).slice(0, 4);
  if (!shown.length) {
    addCopySlide(slide, section, theme, chrome);
    return;
  }
  const width = shown.length <= 1 ? chrome.w - 1.2 : shown.length === 2 ? (chrome.w - 1.1) / 2 : (chrome.w - 1.3) / shown.length;
  const gap = 0.2;
  shown.forEach((stat, index) => {
    const x = 0.45 + index * (width + gap);
    slide.addShape(deck.ShapeType.roundRect, {
      x,
      y: 1.35,
      w: width,
      h: chrome.h - 2.3,
      fill: { color: theme.inverse },
      rectRadius: 0.12,
    });
    slide.addText(stat.value, {
      x,
      y: 1.7,
      w: width,
      h: 1.2,
      margin: 0,
      align: "center",
      fontFace: theme.headingFont,
      fontSize: 32,
      bold: true,
      color: theme.primary,
    });
    slide.addText(stat.label, {
      x: x + 0.15,
      y: chrome.h * 0.58,
      w: width - 0.3,
      h: 0.9,
      margin: 0,
      align: "center",
      fontFace: theme.bodyFont,
      fontSize: 13,
      color: theme.accent,
    });
  });
}

function addCardGrid(slide: PptSlide, deck: PptxGenJS, section: DocSection, theme: DesignDna, chrome: Chrome) {
  const items = section.bullets.slice(0, 4);
  items.forEach((item, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const cardW = (chrome.w - 1.15) / 2;
    const x = 0.45 + col * (cardW + 0.2);
    const y = 1.1 + row * ((chrome.h - 1.8) / 2);
    slide.addShape(deck.ShapeType.roundRect, {
      x,
      y,
      w: cardW,
      h: (chrome.h - 2.15) / 2,
      fill: { color: theme.inverse },
      rectRadius: 0.1,
    });
    slide.addShape(deck.ShapeType.ellipse, {
      x: x + 0.2,
      y: y + 0.25,
      w: 0.28,
      h: 0.28,
      fill: { color: index % 2 === 0 ? theme.primary : theme.accent },
    });
    slide.addText(plainInline(item), {
      x: x + 0.6,
      y: y + 0.18,
      w: cardW - 0.8,
      h: (chrome.h - 2.5) / 2,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 14,
      color: theme.primary,
      valign: "middle",
    });
  });
}

function addTimeline(slide: PptSlide, deck: PptxGenJS, section: DocSection, theme: DesignDna, chrome: Chrome) {
  const items = (section.bullets.length ? section.bullets : linesOf(section)).slice(0, 5);
  items.forEach((item, index) => {
    const y = 1.15 + index * ((chrome.h - 1.7) / Math.max(1, items.length));
    slide.addShape(deck.ShapeType.ellipse, {
      x: 0.5,
      y,
      w: 0.36,
      h: 0.36,
      fill: { color: index % 2 === 0 ? theme.primary : theme.accent },
    });
    slide.addText(String(index + 1), {
      x: 0.5,
      y,
      w: 0.36,
      h: 0.36,
      margin: 0,
      align: "center",
      valign: "middle",
      fontFace: theme.bodyFont,
      fontSize: 12,
      bold: true,
      color: theme.inverse,
    });
    if (index < items.length - 1) {
      slide.addShape(deck.ShapeType.rect, {
        x: 0.65,
        y: y + 0.36,
        w: 0.06,
        h: (chrome.h - 1.7) / items.length - 0.36,
        fill: { color: theme.accent },
      });
    }
    slide.addText(plainInline(item), {
      x: 1.1,
      y,
      w: chrome.w - 1.7,
      h: 0.55,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 16,
      color: theme.primary,
      valign: "middle",
    });
  });
}

function addCompare(slide: PptSlide, section: DocSection, theme: DesignDna, chrome: Chrome) {
  const table = section.table;
  if (table && table.headers.length >= 2) {
    const cols = Math.min(3, table.headers.length);
    const width = (chrome.w - 0.7) / cols;
    table.headers.slice(0, cols).forEach((header, index) => {
      const x = 0.4 + index * width;
      slide.addText(plainInline(header), {
        x,
        y: 1.1,
        w: width - 0.15,
        h: 0.45,
        margin: 0,
        fontFace: theme.headingFont,
        fontSize: 16,
        bold: true,
        color: index === 0 ? theme.primary : theme.accent,
      });
      const lines = table.rows.map((row) => row[index] ?? "").filter(Boolean).slice(0, 8);
      slide.addText(asBullets(lines, false), {
        x,
        y: 1.65,
        w: width - 0.2,
        h: chrome.h - 2.3,
        margin: 0,
        fontFace: theme.bodyFont,
        fontSize: 13,
        color: theme.primary,
        paraSpaceAfter: 6,
      });
    });
    return;
  }
  const items = linesOf(section);
  const mid = Math.ceil(items.length / 2);
  [items.slice(0, mid), items.slice(mid)].forEach((column, index) => {
    const x = 0.45 + index * ((chrome.w - 0.7) / 2);
    slide.addText(asBullets(column.slice(0, 8), false), {
      x,
      y: 1.15,
      w: (chrome.w - 1.1) / 2,
      h: chrome.h - 1.8,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 15,
      color: theme.primary,
      paraSpaceAfter: 8,
    });
  });
}

function addQuote(slide: PptSlide, section: DocSection, theme: DesignDna, chrome: Chrome) {
  const text = section.quote || section.body[0] || section.bullets[0] || section.title;
  slide.addText("“", {
    x: 0.45,
    y: 1.05,
    w: 1,
    h: 0.7,
    margin: 0,
    fontFace: theme.headingFont,
    fontSize: 48,
    color: theme.accent,
  });
  slide.addText(plainInline(text), {
    x: 0.7,
    y: 1.7,
    w: chrome.w - 1.5,
    h: chrome.h - 3.1,
    margin: 0,
    fontFace: theme.headingFont,
    fontSize: 22,
    color: theme.primary,
  });
  slide.addText(plainInline(section.title), {
    x: 0.7,
    y: chrome.h - 1.15,
    w: chrome.w - 1.5,
    h: 0.4,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 14,
    color: theme.accent,
  });
}

function addImageSlide(slide: PptSlide, section: DocSection, theme: DesignDna, chrome: Chrome, image?: SlideImage) {
  if (!image) {
    addCopySlide(slide, section, theme, chrome);
    return;
  }
  const mime = image.mime.includes("png") ? "png" : "jpeg";
  slide.addImage({
    data: `image/${mime};base64,${image.bytes.toString("base64")}`,
    x: 0.45,
    y: 1.1,
    w: chrome.w * 0.52,
    h: chrome.h - 1.8,
  });
  slide.addText(asBullets(linesOf(section).slice(0, 6), false), {
    x: chrome.w * 0.56,
    y: 1.15,
    w: chrome.w * 0.4,
    h: chrome.h - 1.9,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 15,
    color: theme.primary,
    paraSpaceAfter: 8,
  });
}

function addCopySlide(slide: PptSlide, section: DocSection, theme: DesignDna, chrome: Chrome) {
  const bullets = section.bullets;
  const numbered = section.numbered ?? [];
  const body = section.body;
  if (!bullets.length && !numbered.length && !body.length) return;
  const blocks = [
    ...body.map((text) => ({ text: plainInline(text), bullet: false, numbered: false })),
    ...bullets.map((text) => ({ text: plainInline(text), bullet: true, numbered: false })),
    ...numbered.map((text) => ({ text: plainInline(text), bullet: false, numbered: true })),
  ].slice(0, 8);
  slide.addText(
    blocks.map((item, index, all) => ({
      text: item.text,
      options: {
        bullet: item.numbered ? { type: "number" as const } : item.bullet,
        breakLine: index < all.length - 1,
      },
    })),
    {
      x: 0.45,
      y: 1.1,
      w: chrome.w - 0.9,
      h: chrome.h - 1.75,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: blocks.length > 6 ? 15 : 16,
      color: theme.primary,
      paraSpaceAfter: 10,
      valign: "top",
    },
  );
}

function asBullets(lines: string[], numbered: boolean) {
  return lines.map((text, index, all) => ({
    text: plainInline(text),
    options: {
      bullet: numbered ? { type: "number" as const } : true,
      breakLine: index < all.length - 1,
    },
  }));
}

function addLogo(slide: PptSlide, theme: DesignDna, x: number, y: number) {
  if (!theme.logo) return;
  const size = fitLogo(theme.logo, 0.9, 0.36);
  const mime = theme.logo.mime === "image/png" ? "png" : "jpeg";
  slide.addImage({
    data: `image/${mime};base64,${theme.logo.bytes.toString("base64")}`,
    x,
    y,
    w: size.w,
    h: size.h,
  });
}

function goldOrb(slide: PptSlide, deck: PptxGenJS, theme: DesignDna, x: number, y: number, size: number) {
  slide.addShape(deck.ShapeType.ellipse, {
    x,
    y,
    w: size,
    h: size,
    fill: { color: theme.accent },
  });
}

function rich(
  text: string,
  base: { fontFace: string; fontSize: number; bold?: boolean; color: string },
) {
  const parts = parseInline(text);
  if (!parts.length) return plainInline(text);
  return parts.map((part) => ({
    text: part.text,
    options: {
      fontFace: base.fontFace,
      fontSize: base.fontSize,
      color: base.color,
      bold: Boolean(base.bold || part.bold),
      italic: Boolean(part.italic),
    },
  }));
}
