import "server-only";
import JSZip from "jszip";
import type { DocSection, DocumentSpec } from "@/lib/server/document-spec";
import { parseInline, plainInline } from "@/lib/server/rich-text";
import { planSlides, type PlannedSlide } from "@/lib/server/slide-plan";

type Placeholder = {
  type: string;
  idx: string;
  attrs: string;
};

type OfficeLayout = {
  file: string;
  name: string;
  placeholders: Placeholder[];
};

type SlideJob = {
  title: string;
  subtitle: string;
  lines: string[];
  want: "cover" | "section" | "compare" | "content";
};

const SLIDE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const LAYOUT_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";

export async function clonePptxWithSpec(
  template: Buffer,
  spec: DocumentSpec,
  options: { synthesized?: boolean } = {},
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template);
  const layouts = await readLayouts(zip);
  const usable = layouts.filter((layout) => layout.placeholders.length > 0);
  if (!usable.length) {
    throw new Error("Le modèle PowerPoint n'a pas de mise en page avec des espaces réservés.");
  }

  const jobs = slideJobs(spec, options.synthesized);
  await removeExistingSlides(zip);
  const size = await slideSize(zip);
  const created: { id: number; rel: string }[] = [];
  let shapeSeq = 2;

  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    const layout = pickLayout(usable, job.want);
    const file = `ppt/slides/slide${index + 1}.xml`;
    const relFile = `ppt/slides/_rels/slide${index + 1}.xml.rels`;
    const built = renderSlide(layout, job, size, shapeSeq);
    shapeSeq = built.nextId;
    zip.file(file, built.xml);
    zip.file(
      relFile,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${LAYOUT_REL}" Target="../${layout.file}"/>` +
        `</Relationships>`,
    );
    created.push({ id: 256 + index, rel: "" });
  }

  await registerSlides(zip, created.length);
  return zip.generateAsync({ type: "uint8array" });
}

function slideJobs(spec: DocumentSpec, synthesized?: boolean): SlideJob[] {
  const jobs: SlideJob[] = [];
  if (spec.design?.couverture !== false) {
    jobs.push({ title: plainInline(spec.title), subtitle: plainInline(spec.subtitle), lines: [], want: "cover" });
  }
  const planned = planSlides(spec).slice(0, 80);
  planned.forEach((slide, index) => {
    jobs.push(jobFromPlanned(slide, index === 0 && synthesized));
  });
  if (spec.design?.conclusion !== false) {
    jobs.push({ title: "Merci", subtitle: plainInline(spec.title), lines: [], want: "cover" });
  }
  return jobs.length ? jobs : [{ title: plainInline(spec.title), subtitle: "", lines: [], want: "content" }];
}

function jobFromPlanned(slide: PlannedSlide, synthesized?: boolean): SlideJob {
  const title = plainInline(slide.section.title) + (slide.continuation ? " (suite)" : "");
  const lines = contentLines(slide.section);
  if (synthesized) lines.push("Contenu synthétisé pour le format diapositive.");
  if (slide.layout === "divider") return { title, subtitle: lines[0] ?? "", lines: lines.slice(1), want: "section" };
  if (slide.layout === "compare") return { title, subtitle: "", lines, want: "compare" };
  return { title, subtitle: slide.section.quote ? plainInline(slide.section.quote) : "", lines, want: "content" };
}

function contentLines(section: DocSection): string[] {
  const lines = [...section.body, ...section.bullets, ...(section.numbered ?? [])];
  if (section.quote) lines.unshift(section.quote);
  if (section.table) {
    lines.push(section.table.headers.join(" "));
    for (const row of section.table.rows) lines.push(row.filter(Boolean).join(" "));
  }
  if (section.chart) {
    lines.push(section.chart.title);
    section.chart.categories.forEach((category, index) => {
      const values = section.chart!.series.map((series) => `${series.name} ${series.values[index] ?? ""}`).join(" ");
      lines.push(`${category} ${values}`);
    });
  }
  return lines.map((line) => plainInline(line)).filter(Boolean);
}

async function readLayouts(zip: JSZip): Promise<OfficeLayout[]> {
  const files = Object.keys(zip.files)
    .filter((name) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/i.test(name))
    .sort((a, b) => layoutIndex(a) - layoutIndex(b));
  const layouts: OfficeLayout[] = [];
  for (const file of files) {
    const xml = await zip.files[file].async("string");
    layouts.push({
      file: file.replace(/^ppt\//, ""),
      name: /<p:cSld\b[^>]*\bname="([^"]*)"/.exec(xml)?.[1] ?? "",
      placeholders: placeholdersFrom(xml),
    });
  }
  return layouts;
}

function placeholdersFrom(xml: string): Placeholder[] {
  const found: Placeholder[] = [];
  for (const chunk of xml.split(/<p:sp(?=[\s>])/).slice(1)) {
    const ph = /<p:ph\b([^>]*?)\/?>/.exec(chunk);
    if (!ph) continue;
    const attrs = ph[1].trim();
    const type = /type="([^"]+)"/.exec(attrs)?.[1] ?? "obj";
    if (type === "dt" || type === "ftr" || type === "sldNum" || type === "hdr") continue;
    const idx = /idx="([^"]+)"/.exec(attrs)?.[1] ?? (type === "title" || type === "ctrTitle" ? "0" : "1");
    found.push({ type, idx, attrs: attrs || `type="${type}"` });
  }
  return found;
}

function pickLayout(layouts: OfficeLayout[], want: SlideJob["want"]): OfficeLayout {
  const ranked = [...layouts].sort((a, b) => scoreLayout(b, want) - scoreLayout(a, want));
  return ranked[0] ?? layouts[0];
}

function scoreLayout(layout: OfficeLayout, want: SlideJob["want"]): number {
  const name = layout.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const titles = layout.placeholders.filter((item) => item.type === "title" || item.type === "ctrTitle").length;
  const subs = layout.placeholders.filter((item) => item.type === "subTitle").length;
  const bodies = layout.placeholders.filter((item) => item.type === "body" || item.type === "obj").length;
  let score = titles + bodies;
  if (want === "cover") {
    if (/title|titre|couverture|cover/.test(name)) score += 6;
    if (subs) score += 3;
    if (bodies > 1) score -= 3;
  } else if (want === "section") {
    if (/section|separateur|intertitre|divider/.test(name)) score += 6;
    if (titles && bodies === 0) score += 4;
    if (bodies > 1) score -= 2;
  } else if (want === "compare") {
    if (/compar|deux|two|column/.test(name)) score += 6;
    if (bodies >= 2) score += 5;
  } else {
    if (/content|contenu|objet|object|texte/.test(name)) score += 4;
    if (titles && bodies >= 1) score += 4;
  }
  return score;
}

function renderSlide(
  layout: OfficeLayout,
  job: SlideJob,
  size: { cx: number; cy: number },
  startId: number,
): { xml: string; nextId: number } {
  const titles = layout.placeholders.filter((item) => item.type === "title" || item.type === "ctrTitle");
  const subs = layout.placeholders.filter((item) => item.type === "subTitle");
  const bodies = layout.placeholders.filter((item) => item.type === "body" || item.type === "obj");
  const buckets = new Map<Placeholder, string[]>();
  for (const placeholder of layout.placeholders) buckets.set(placeholder, []);
  for (const placeholder of titles) buckets.set(placeholder, [job.title]);
  if (subs[0]) buckets.set(subs[0], [job.subtitle || job.lines[0] || ""]);
  const bodyLines = subs.length ? job.lines : job.subtitle ? [job.subtitle, ...job.lines] : [...job.lines];
  if (bodies.length) {
    const chunk = Math.ceil(bodyLines.length / bodies.length) || 0;
    bodies.forEach((placeholder, index) => {
      const slice = chunk ? bodyLines.slice(index * chunk, (index + 1) * chunk) : [];
      buckets.set(placeholder, slice);
    });
  }

  let id = startId;
  const shapes: string[] = [];
  for (const placeholder of layout.placeholders) {
    const lines = (buckets.get(placeholder) ?? []).filter(Boolean);
    const bullet = placeholder.type === "body" || placeholder.type === "obj";
    shapes.push(placeholderShape(id, placeholder, lines, bullet));
    id += 1;
  }
  const placed = bodies.length > 0 || subs.length > 0;
  if (!placed && bodyLines.filter(Boolean).length) {
    shapes.push(freeText(id, bodyLines.filter(Boolean), size));
    id += 1;
  }
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    shapes.join("") +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  return { xml, nextId: id };
}

function placeholderShape(id: number, placeholder: Placeholder, lines: string[], bullet: boolean): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(placeholder.type)}"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph ${placeholder.attrs}/></p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs(lines, bullet)}</p:txBody></p:sp>`
  );
}

function freeText(id: number, lines: string[], size: { cx: number; cy: number }): string {
  const x = Math.round(size.cx * 0.08);
  const y = Math.round(size.cy * 0.28);
  const cx = Math.round(size.cx * 0.84);
  const cy = Math.round(size.cy * 0.62);
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Contenu"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs(lines, true)}</p:txBody></p:sp>`
  );
}

function paragraphs(lines: string[], bullet: boolean): string {
  const source = lines.length ? lines : [""];
  return source
    .map((line) => {
      const runs = parseInline(line);
      const parts = runs.length ? runs : [{ text: line }];
      const body = parts
        .map((part) => {
          const bold = part.bold ? ` b="1"` : "";
          const italic = part.italic ? ` i="1"` : "";
          return `<a:r><a:rPr lang="fr-FR"${bold}${italic}/><a:t xml:space="preserve">${esc(part.text)}</a:t></a:r>`;
        })
        .join("");
      const props = bullet ? `<a:pPr lvl="0"/>` : `<a:pPr><a:buNone/></a:pPr>`;
      return `<a:p>${props}${body}</a:p>`;
    })
    .join("");
}

async function removeExistingSlides(zip: JSZip): Promise<void> {
  const relsPath = "ppt/_rels/presentation.xml.rels";
  const rels = (await zip.file(relsPath)?.async("string")) ?? "";
  const slideTargets = relationships(rels)
    .filter((item) => item.type === SLIDE_REL)
    .map((item) => normalizePath("ppt", item.target));

  for (const slidePath of slideTargets) {
    const relPath = relsPathFor(slidePath);
    const slideRels = (await zip.file(relPath)?.async("string")) ?? "";
    for (const rel of relationships(slideRels)) {
      if (!rel.type.endsWith("/notesSlide")) continue;
      const notesPath = resolveTarget(slidePath, rel.target);
      zip.remove(notesPath);
      zip.remove(relsPathFor(notesPath));
    }
    zip.remove(slidePath);
    zip.remove(relPath);
  }

  zip.file(
    relsPath,
    rels.replace(/<Relationship\b[^>]*Type="[^"]*\/relationships\/slide"[^>]*\/>/g, ""),
  );
  const contentPath = "[Content_Types].xml";
  const content = (await zip.file(contentPath)?.async("string")) ?? "";
  zip.file(
    contentPath,
    content
      .replace(/<Override\b[^>]*PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>/g, "")
      .replace(/<Override\b[^>]*PartName="\/ppt\/notesSlides\/notesSlide\d+\.xml"[^>]*\/>/g, ""),
  );
  const presentation = await zip.file("ppt/presentation.xml")?.async("string");
  if (presentation) zip.file("ppt/presentation.xml", replaceSlideList(presentation, ""));
}

async function registerSlides(zip: JSZip, count: number): Promise<void> {
  const relsPath = "ppt/_rels/presentation.xml.rels";
  let rels = (await zip.file(relsPath)?.async("string")) ?? "";
  const used = [...rels.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]));
  let nextRel = (used.length ? Math.max(...used) : 0) + 1;
  const entries: string[] = [];
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const rel = `rId${nextRel}`;
    nextRel += 1;
    entries.push(
      `<Relationship Id="${rel}" Type="${SLIDE_REL}" Target="slides/slide${index + 1}.xml"/>`,
    );
    ids.push(`<p:sldId id="${256 + index}" r:id="${rel}"/>`);
  }
  rels = rels.replace("</Relationships>", `${entries.join("")}</Relationships>`);
  zip.file(relsPath, rels);

  const presentation = (await zip.file("ppt/presentation.xml")?.async("string")) ?? "";
  zip.file("ppt/presentation.xml", replaceSlideList(presentation, ids.join("")));

  const contentPath = "[Content_Types].xml";
  let content = (await zip.file(contentPath)?.async("string")) ?? "";
  const overrides = Array.from({ length: count }, (_, index) => {
    const part = `/ppt/slides/slide${index + 1}.xml`;
    if (content.includes(part)) return "";
    return `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
  }).join("");
  content = content.replace("</Types>", `${overrides}</Types>`);
  zip.file(contentPath, content);
}

function replaceSlideList(presentation: string, inner: string): string {
  if (/<p:sldIdLst\b[^>]*\/>/.test(presentation)) {
    return presentation.replace(/<p:sldIdLst\b[^>]*\/>/, `<p:sldIdLst>${inner}</p:sldIdLst>`);
  }
  if (/<p:sldIdLst\b[^>]*>[\s\S]*?<\/p:sldIdLst>/.test(presentation)) {
    return presentation.replace(/<p:sldIdLst\b[^>]*>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${inner}</p:sldIdLst>`);
  }
  return presentation.replace("</p:sldMasterIdLst>", `</p:sldMasterIdLst><p:sldIdLst>${inner}</p:sldIdLst>`);
}

async function slideSize(zip: JSZip): Promise<{ cx: number; cy: number }> {
  const presentation = (await zip.file("ppt/presentation.xml")?.async("string")) ?? "";
  const cx = Number(/<p:sldSz\b[^>]*\bcx="(\d+)"/.exec(presentation)?.[1] ?? 9144000);
  const cy = Number(/<p:sldSz\b[^>]*\bcy="(\d+)"/.exec(presentation)?.[1] ?? 5143500);
  return { cx, cy };
}

function relationships(xml: string): { type: string; target: string }[] {
  return [...xml.matchAll(/<Relationship\b[^>]*>/g)].map((match) => ({
    type: /Type="([^"]+)"/.exec(match[0])?.[1] ?? "",
    target: /Target="([^"]+)"/.exec(match[0])?.[1] ?? "",
  }));
}

function normalizePath(root: string, target: string): string {
  const parts = [...root.split("/"), ...target.split("/")];
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function resolveTarget(fromFile: string, target: string): string {
  return normalizePath(fromFile.split("/").slice(0, -1).join("/"), target);
}

function relsPathFor(file: string): string {
  const bits = file.split("/");
  const name = bits.pop() ?? "";
  return `${bits.join("/")}/_rels/${name}.rels`;
}

function layoutIndex(file: string): number {
  return Number(/slideLayout(\d+)\.xml/.exec(file)?.[1] ?? 0);
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
