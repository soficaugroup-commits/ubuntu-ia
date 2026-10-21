import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildDocx } from "@/lib/server/generate-chat-docx";
import { buildPdf } from "@/lib/server/generate-chat-pdf";
import { buildPptx } from "@/lib/server/generate-chat-pptx";
import { buildXlsx } from "@/lib/server/generate-chat-xlsx";
import { validateGenerated } from "@/lib/server/office-validate";
import { BOXES, fits, MAX_LINES_PER_SLIDE, planSlides, linesOf } from "@/lib/server/slide-plan";
import { richSpec, shortSpec } from "./fixtures/rich-spec";

async function unzip(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const read = async (name: string) => (await zip.file(name)?.async("string")) ?? "";
  const all = async (pattern: RegExp) => {
    const names = Object.keys(zip.files).filter((name) => pattern.test(name));
    return (await Promise.all(names.map(read))).join("\n");
  };
  return { zip, read, all };
}

describe("Word", () => {
  it("porte les styles de titre, la pagination, la TOC et les légendes", async () => {
    const bytes = await buildDocx(richSpec());
    expect((await validateGenerated("docx", bytes)).ok).toBe(true);
    const { read, all } = await unzip(bytes);
    const styles = await read("word/styles.xml");
    const document = await read("word/document.xml");
    const footers = await all(/^word\/footer\d*\.xml$/);
    const headers = await all(/^word\/header\d*\.xml$/);

    expect(styles).toMatch(/w:styleId="Heading1"/);
    expect(document).toMatch(/<w:pStyle w:val="Heading1"\/>/);
    expect(document).toMatch(/<w:pStyle w:val="Heading2"\/>/);
    expect(footers).toMatch(/PAGE/);
    expect(footers).toMatch(/NUMPAGES/);
    expect(footers).toContain("Page ");
    expect(headers).toContain("SOFICAU Ubuntu Group");
    expect(document).toMatch(/TOC \\/);
    expect(document).toContain("Tableau 1 — Résultats par filiale");
    expect(document).toMatch(/Figure 1 — Chiffre d(&apos;|')affaires par place/);
    expect(document).toMatch(/<w:tblHeader\/>/);
    expect(document).toContain("17405B");
  });

  it("n'ajoute pas de table des matières sous trois titres", async () => {
    const { read } = await unzip(await buildDocx(shortSpec()));
    expect(await read("word/document.xml")).not.toMatch(/TOC \\/);
  });
});

describe("PDF", () => {
  it("produit un PDF valide, paginé, avec sommaire", async () => {
    const bytes = await buildPdf(richSpec());
    expect((await validateGenerated("pdf", bytes)).ok).toBe(true);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(4);
  });

  it("reste court pour un document court", async () => {
    const pdf = await PDFDocument.load(await buildPdf(shortSpec()));
    expect(pdf.getPageCount()).toBe(2);
  });
});

describe("Excel", () => {
  it("écrit de vraies formules, des formats FR et une mise en page A4", async () => {
    const spec = richSpec();
    spec.sections[1].table!.rows.push(["Total", "999", "", ""]);
    const bytes = await buildXlsx(spec, []);
    expect((await validateGenerated("xlsx", bytes)).ok).toBe(true);
    const { all, read } = await unzip(bytes);
    const sheets = await all(/^xl\/worksheets\/sheet\d+\.xml$/);
    const tables = await all(/^xl\/tables\/table\d+\.xml$/);
    const stylesXml = await read("xl/styles.xml");

    expect(sheets).toMatch(/<f>[^<]*SUM\(/);
    expect(sheets).toMatch(/SUBTOTAL\(109/);
    expect(sheets).toMatch(/SUBTOTAL\(101/);
    expect(sheets).not.toMatch(/<v>999<\/v>/);
    expect(sheets).toMatch(/<pageSetup[^>]*paperSize="9"/);
    expect(sheets).toMatch(/fitToWidth="1"/);
    expect(sheets).toMatch(/<pane[^>]*ySplit="3"/);
    expect(tables).toMatch(/totalsRowFunction="sum"/);
    expect(stylesXml).toContain("dd/mm/yyyy");
    // `#,##0` est le format intégré n° 3 d'Excel : référencé par identifiant, pas recopié.
    expect(stylesXml).toMatch(/numFmtId="3"/);
    expect(stylesXml).toMatch(/formatCode="0\.0%"/);
  });
});

describe("PowerPoint", () => {
  it("numérote les diapos et ne dépasse jamais la zone de texte", async () => {
    const spec = richSpec();
    const planned = planSlides(spec);
    for (const slide of planned.filter((item) => item.layout === "copy")) {
      const lines = linesOf(slide.section);
      expect(lines.length).toBeLessThanOrEqual(MAX_LINES_PER_SLIDE);
      expect(fits(lines, BOXES.copy)).toBe(true);
    }
    const tableSlides = planned.filter((item) => item.layout === "table");
    expect(tableSlides.length).toBe(5);

    const bytes = await buildPptx(spec);
    expect((await validateGenerated("pptx", bytes)).ok).toBe(true);
    const { zip, all } = await unzip(bytes);
    const slideCount = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
    expect(slideCount).toBe(planned.length + 2);
    const masters = await all(/^ppt\/slideLayouts\/slideLayout\d+\.xml$/);
    expect(masters).toMatch(/type="slidenum"/);
    const notes = await all(/^ppt\/notesSlides\/notesSlide\d+\.xml$/);
    expect(notes).toContain("Action prioritaire numéro 9");
  });
});

describe("Validation", () => {
  it("refuse une archive corrompue et un PDF tronqué", async () => {
    expect((await validateGenerated("docx", new Uint8Array([1, 2, 3]))).ok).toBe(false);
    expect((await validateGenerated("pdf", new TextEncoder().encode("%PDF-1.7 tronqué"))).ok).toBe(false);
  });
});
