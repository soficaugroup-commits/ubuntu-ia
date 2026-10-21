import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { DocumentSpec } from "@/lib/server/document-spec";
import { mergeSplitTags } from "@/lib/server/ooxml-text";
import { analyzeTemplate, fillTemplate } from "@/lib/server/template-fill";
import { matchTemplate } from "@/lib/server/template-match";
import { shiftFormulaRows } from "@/lib/server/template-xlsx";
import { validateGenerated } from "@/lib/server/office-validate";
import type { DocumentTemplate } from "@/lib/types";

function cell(...runs: string[]): TableCell {
  return new TableCell({ children: [new Paragraph({ children: runs.map((text) => new TextRun(text)) })] });
}

async function wordTemplate(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun("Client : "), new TextRun("{{"), new TextRun("cli"), new TextRun("ent}}")] }),
          new Paragraph({ children: [new TextRun("Date : {{date}} — réf. {{reference}}")] }),
          new Paragraph({ text: "Contexte", heading: HeadingLevel.HEADING_1 }),
          new Table({
            rows: [
              new TableRow({ children: [cell("Désignation"), cell("Montant")] }),
              new TableRow({ children: [cell("{{#lignes}}{{desig", "nation}}"), cell("{{montant}}{{/lignes}}")] }),
            ],
          }),
          new Paragraph({ children: [new TextRun("{{contenu}}")] }),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

function spec(): DocumentSpec {
  return {
    title: "Offre de services",
    subtitle: "",
    charts: [],
    sections: [
      { title: "Contexte", body: ["Le client souhaite moderniser son système."], bullets: [] },
      { title: "Proposition", body: ["Nous proposons un accompagnement en trois phases."], bullets: [] },
    ],
    fields: { client: "Banque Atlantique" },
    loops: {
      lignes: [
        { designation: "Audit", montant: "1 200" },
        { designation: "Déploiement", montant: "3 400" },
        { designation: "Formation", montant: "800" },
      ],
    },
  };
}

describe("Balises Office", () => {
  it("regroupe une balise coupée entre plusieurs runs", () => {
    const xml =
      '<w:p><w:r><w:t>Bonjour {{</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>no</w:t></w:r><w:r><w:t>m}} !</w:t></w:r></w:p>';
    const merged = mergeSplitTags(xml, "w:p", "w:t");
    expect(merged).toContain("{{nom}}");
    expect(merged).toContain(" !</w:t>");
  });
});

describe("Remplissage Word", () => {
  it("remplit les champs, duplique les lignes et place les sections", async () => {
    const template = await wordTemplate();
    const analysis = await analyzeTemplate("docx", template);
    expect(analysis.champs.map((item) => item.nom)).toEqual(expect.arrayContaining(["client", "date", "reference", "lignes"]));
    expect(analysis.champs.find((item) => item.nom === "lignes")?.colonnes).toEqual(["designation", "montant"]);
    expect(analysis.structure.titres).toContain("Contexte");

    const result = await fillTemplate("docx", template, spec());
    expect(result.mode).toBe("balises");
    expect(result.missing).toEqual(["reference"]);
    expect((await validateGenerated("docx", result.bytes)).ok).toBe(true);
    const xml = await (await JSZip.loadAsync(result.bytes)).file("word/document.xml")!.async("string");
    expect(xml).toContain("Banque Atlantique");
    expect(xml).toContain("[à compléter : reference]");
    expect(xml).not.toMatch(/\{\{/);
    expect((xml.match(/<w:tr>/g) ?? []).length).toBe(4);
    expect(xml.indexOf("Audit")).toBeLessThan(xml.indexOf("Formation"));
    expect(xml.indexOf("Contexte")).toBeLessThan(xml.indexOf("moderniser"));
    expect(xml).toContain("Proposition");
  });
});

async function excelTemplate(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Devis");
  sheet.getCell("A1").value = "Client : {{client}}";
  sheet.getCell("B2").value = "";
  sheet.getCell("B2").name = "Reference";
  sheet.addTable({
    name: "Lignes",
    ref: "A4",
    headerRow: true,
    totalsRow: true,
    columns: [
      { name: "Designation", totalsRowLabel: "Total" },
      { name: "Quantite" },
      { name: "PU" },
      { name: "Montant", totalsRowFunction: "sum" },
    ],
    rows: [["Exemple", 1, 10, { formula: "B5*C5", result: 10 }]],
  });
  sheet.getCell("F1").value = { formula: "SUM(D5:D5)", result: 10 };
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe("Remplissage Excel", () => {
  it("agrandit le tableau sans toucher aux formules", async () => {
    const template = await excelTemplate();
    const analysis = await analyzeTemplate("xlsx", template);
    expect(analysis.champs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nom: "client", type: "texte" }),
        expect.objectContaining({ nom: "Reference", type: "nom_defini" }),
        expect.objectContaining({ nom: "Lignes", type: "tableau" }),
      ]),
    );
    const filled = await fillTemplate("xlsx", template, {
      ...spec(),
      fields: { client: "Banque Atlantique", reference: "DEV-2026-014" },
      loops: {
        lignes: [
          { designation: "Audit", quantite: "2", pu: "600" },
          { designation: "Déploiement", quantite: "1", pu: "3 400" },
          { designation: "Formation", quantite: "4", pu: "200" },
        ],
      },
    });
    expect(filled.warnings).toEqual([]);
    expect((await validateGenerated("xlsx", filled.bytes)).ok).toBe(true);

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(filled.bytes) as unknown as ArrayBuffer);
    const sheet = book.getWorksheet("Devis")!;
    expect(String(sheet.getCell("A1").value)).toBe("Client : Banque Atlantique");
    expect(sheet.getCell("B2").value).toBe("DEV-2026-014");
    expect(sheet.getCell("A5").value).toBe("Audit");
    expect(sheet.getCell("C6").value).toBe(3400);
    expect(sheet.getCell("A7").value).toBe("Formation");
    expect((sheet.getCell("D7").value as { formula?: string }).formula).toBe("B7*C7");
    expect((sheet.getCell("F1").value as { formula?: string }).formula).toBe("SUM(D5:D5)");
    expect(String(sheet.getCell("A8").value)).toBe("Total");

    const zip = await JSZip.loadAsync(filled.bytes);
    const table = Object.keys(zip.files).find((name) => /xl\/tables\/table\d+\.xml/.test(name))!;
    expect(await zip.file(table)!.async("string")).toContain('ref="A4:D8"');
  });

  it("décale les références relatives d'une formule", () => {
    expect(shiftFormulaRows("B5*C5+$D$1+SUM(E5:E$9)", 2)).toBe("B7*C7+$D$1+SUM(E7:E$9)");
    expect(shiftFormulaRows('IF(A5="B5";LOG10(A5);0)', 1)).toBe('IF(A6="B5";LOG10(A6);0)');
  });
});

function template(nom: string, format: DocumentTemplate["format"] = "docx"): DocumentTemplate {
  return {
    id: nom,
    nom,
    description: "",
    format,
    categorie: null,
    champs: [],
    structure: {},
    actif: true,
    apercuUrl: null,
    created_at: "",
    updated_at: "",
  };
}

describe("Correspondance de modèle", () => {
  const catalogue = [template("Offre commerciale"), template("Note de service"), template("Comité de direction", "pptx")];

  it("retient le modèle cité par son nom", () => {
    expect(matchTemplate("Rédige une offre avec le modèle Offre commerciale", catalogue)?.nom).toBe(
      "Offre commerciale",
    );
    expect(matchTemplate("Pars de notre trame de note de service", catalogue)?.nom).toBe("Note de service");
  });

  it("ignore une demande générique sans nom de modèle", () => {
    expect(matchTemplate("Rédige un modèle de contrat pour un client", catalogue)).toBeNull();
    expect(matchTemplate("Prépare une offre commerciale en Word", catalogue)).toBeNull();
  });
});
