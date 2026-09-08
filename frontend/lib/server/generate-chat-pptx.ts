import "server-only";
import PptxGenJS from "pptxgenjs";
import { defaultDna, fitLogo, pptFont, type DesignDna } from "@/lib/server/design-dna";
import type { DocChart, DocumentSpec, DocSection } from "@/lib/server/document-spec";

type PptSlide = ReturnType<PptxGenJS["addSlide"]>;

export async function buildPptx(
  spec: DocumentSpec,
  dna: DesignDna = defaultDna(),
  options: { synthesized?: boolean } = {},
): Promise<Uint8Array> {
  const theme = { ...dna, headingFont: pptFont(dna.headingFont), bodyFont: pptFont(dna.bodyFont) };
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_16x9";
  deck.author = "Ubuntu IA";
  deck.title = spec.title;
  deck.subject = "SOFICAU Ubuntu Group";

  addCover(deck, spec, theme);
  const sections = spec.sections.slice(0, 10);
  sections.forEach((section, index) =>
    addSectionSlide(deck, section, index, theme, options.synthesized),
  );
  addClose(deck, spec, theme);

  const output = await deck.write({ outputType: "nodebuffer" });
  return output instanceof Uint8Array ? output : new Uint8Array(output as ArrayBuffer);
}

function addCover(deck: PptxGenJS, spec: DocumentSpec, theme: DesignDna) {
  const slide = deck.addSlide();
  slide.background = { color: theme.primary };
  goldOrb(slide, deck, theme, 7.6, -0.7, 3.2);
  goldOrb(slide, deck, theme, -0.9, 3.8, 2.1);
  slide.addText("UBUNTU IA", {
    x: 0.6,
    y: 1.15,
    w: 8.5,
    h: 0.35,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 13,
    bold: true,
    color: theme.accent,
    charSpacing: 3,
  });
  slide.addText(spec.title, {
    x: 0.6,
    y: 1.6,
    w: 8.6,
    h: 1.6,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 36,
    bold: true,
    color: theme.inverse,
    valign: "top",
  });
  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 0.6,
      y: 3.35,
      w: 8.2,
      h: 0.9,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 16,
      color: theme.muted,
    });
  }
  slide.addText("SOFICAU Ubuntu Group", {
    x: 0.6,
    y: 5.05,
    w: 7.5,
    h: 0.3,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 12,
    color: theme.accent,
  });
  addLogo(slide, theme, 8.55, 4.95);
}

function addClose(deck: PptxGenJS, spec: DocumentSpec, theme: DesignDna) {
  const slide = deck.addSlide();
  slide.background = { color: theme.primary };
  goldOrb(slide, deck, theme, 8.1, 3.7, 2.4);
  slide.addText("Merci", {
    x: 0.6,
    y: 1.7,
    w: 8.5,
    h: 0.9,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 40,
    bold: true,
    color: theme.inverse,
  });
  slide.addText(spec.title, {
    x: 0.6,
    y: 2.7,
    w: 8.2,
    h: 0.7,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 16,
    color: theme.muted,
  });
  slide.addText("Document généré par Ubuntu IA  ·  SOFICAU Ubuntu Group", {
    x: 0.6,
    y: 4.9,
    w: 8.5,
    h: 0.3,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 12,
    color: theme.accent,
  });
}

function addSectionSlide(
  deck: PptxGenJS,
  section: DocSection,
  index: number,
  theme: DesignDna,
  synthesized?: boolean,
) {
  const slide = deck.addSlide();
  slide.background = { color: theme.canvas };
  goldOrb(slide, deck, theme, 9.15, -0.55, 1.4);
  addLogo(slide, theme, 9.05, 5.15);
  if (synthesized) {
    slide.addText("Contenu synthétisé pour le format diapositive.", {
      x: 0.45,
      y: 5.28,
      w: 7.8,
      h: 0.22,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 9,
      color: theme.muted,
    });
  }
  slide.addText(section.title, {
    x: 0.45,
    y: 0.28,
    w: 8.5,
    h: 0.62,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 28,
    bold: true,
    color: theme.primary,
  });

  if (section.chart) {
    addChartSlide(slide, deck, section, theme);
    return;
  }
  if (section.table) {
    addTableSlide(slide, deck, section, theme);
    return;
  }

  const stats = statsFromSection(section);
  if (stats.length >= 2) {
    addStatSlide(slide, deck, stats, theme);
    return;
  }
  if (index % 2 === 1 && section.bullets.length >= 2) {
    addCardGrid(slide, deck, section, theme);
    return;
  }
  addCopySlide(slide, section, theme);
}

function addChartSlide(slide: PptSlide, deck: PptxGenJS, section: DocSection, theme: DesignDna) {
  const chart = section.chart as DocChart;
  const hasCopy = section.bullets.length > 0 || section.body.length > 0;
  const chartX = hasCopy ? 4.55 : 0.45;
  const chartW = hasCopy ? 5.05 : 9.1;

  if (hasCopy) {
    const lines = [...section.body.slice(0, 2), ...section.bullets.slice(0, 6)];
    slide.addText(asBullets(lines), {
      x: 0.45,
      y: 1.05,
      w: 3.85,
      h: 4.15,
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
    chart.kind === "pie"
      ? deck.ChartType.pie
      : chart.kind === "line"
        ? deck.ChartType.line
        : deck.ChartType.bar;

  slide.addChart(type, data, {
    x: chartX,
    y: 1.05,
    w: chartW,
    h: 4.15,
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

function addTableSlide(slide: PptSlide, _deck: PptxGenJS, section: DocSection, theme: DesignDna) {
  const table = section.table;
  if (!table) return;
  const header = table.headers.map((cell) => ({
    text: cell,
    options: {
      fill: { color: theme.tableHeaderFill },
      color: theme.inverse,
      bold: true,
      align: "center" as const,
      valign: "middle" as const,
    },
  }));
  const rows = table.rows.slice(0, 8).map((row, rowIndex) =>
    table.headers.map((_, index) => ({
      text: row[index] ?? "",
      options: {
        fill: { color: theme.zebra && rowIndex % 2 === 1 ? theme.tableBodyFill : theme.inverse },
        color: theme.primary,
        align: "left" as const,
      },
    })),
  );
  slide.addTable([header, ...rows], {
    x: 0.45,
    y: 1.05,
    w: 9.1,
    h: 4.15,
    colW: table.headers.map(() => 9.1 / Math.max(1, table.headers.length)),
    border: [
      { pt: 0, color: theme.canvas },
      { pt: 0, color: theme.canvas },
      { pt: 0, color: theme.canvas },
      { pt: 0, color: theme.canvas },
    ],
    fontFace: theme.bodyFont,
    fontSize: 12,
    valign: "middle",
  });
}

function addStatSlide(slide: PptSlide, deck: PptxGenJS, stats: { value: string; label: string }[], theme: DesignDna) {
  const shown = stats.slice(0, 4);
  const width = shown.length === 1 ? 8.8 : shown.length === 2 ? 4.25 : 2.1;
  const gap = 0.2;
  const start = 0.45;
  shown.forEach((stat, index) => {
    const x = start + index * (width + gap);
    slide.addShape(deck.ShapeType.roundRect, {
      x,
      y: 1.35,
      w: width,
      h: 3.4,
      fill: { color: theme.inverse },
      rectRadius: 0.12,
      shadow: {
        type: "outer",
        color: theme.primary,
        blur: 10,
        offset: 3,
        angle: 135,
        opacity: 0.12,
      },
    });
    slide.addText(stat.value, {
      x,
      y: 1.85,
      w: width,
      h: 1.4,
      margin: 0,
      align: "center",
      fontFace: theme.bodyFont,
      fontSize: 36,
      bold: true,
      color: theme.primary,
    });
    slide.addText(stat.label, {
      x: x + 0.15,
      y: 3.4,
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

function addCardGrid(slide: PptSlide, deck: PptxGenJS, section: DocSection, theme: DesignDna) {
  const items = section.bullets.slice(0, 4);
  items.forEach((item, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 0.45 + col * 4.65;
    const y = 1.1 + row * 2.05;
    slide.addShape(deck.ShapeType.roundRect, {
      x,
      y,
      w: 4.45,
      h: 1.9,
      fill: { color: theme.inverse },
      rectRadius: 0.1,
      shadow: {
        type: "outer",
        color: theme.primary,
        blur: 8,
        offset: 3,
        angle: 135,
        opacity: 0.1,
      },
    });
    slide.addShape(deck.ShapeType.ellipse, {
      x: x + 0.2,
      y: y + 0.25,
      w: 0.28,
      h: 0.28,
      fill: { color: index % 2 === 0 ? theme.primary : theme.accent },
    });
    slide.addText(item, {
      x: x + 0.6,
      y: y + 0.22,
      w: 3.65,
      h: 1.45,
      margin: 0,
      fontFace: theme.bodyFont,
      fontSize: 14,
      color: theme.primary,
      valign: "middle",
    });
  });
}

function addCopySlide(slide: PptSlide, section: DocSection, theme: DesignDna) {
  const lines = [...section.body, ...section.bullets];
  if (!lines.length) {
    slide.addText(" ", { x: 0.45, y: 1.2, w: 9, h: 1, fontFace: theme.bodyFont });
    return;
  }
  slide.addText(asBullets(lines.slice(0, 8)), {
    x: 0.45,
    y: 1.1,
    w: 9.1,
    h: 4.1,
    margin: 0,
    fontFace: theme.bodyFont,
    fontSize: 16,
    color: theme.primary,
    paraSpaceAfter: 10,
    valign: "top",
  });
}

function asBullets(lines: string[]) {
  return lines.map((text, index, all) => ({
    text,
    options: {
      bullet: true,
      breakLine: index < all.length - 1,
    },
  }));
}

function addLogo(slide: PptSlide, theme: DesignDna, x: number, y: number) {
  if (!theme.logo) return;
  const size = fitLogo(theme.logo, 0.9, 0.36);
  slide.addImage({
    data: `image/${theme.logo.mime === "image/png" ? "png" : "jpeg"};base64,${theme.logo.bytes.toString("base64")}`,
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
    shadow: {
      type: "outer",
      color: theme.primary,
      blur: 16,
      offset: 4,
      angle: 135,
      opacity: 0.18,
    },
  });
}

function statsFromSection(section: DocSection): { value: string; label: string }[] {
  const found: { value: string; label: string }[] = [];
  const scan = [...section.bullets, ...section.body];
  for (const line of scan) {
    const match = line.match(/(-?\d+(?:[.,]\d+)?\s?%?)/);
    if (!match) continue;
    found.push({
      value: match[1].replace(/\s/g, ""),
      label: line.replace(match[1], "").replace(/^[\s:–—-]+/, "").slice(0, 80) || section.title,
    });
  }
  return found;
}
