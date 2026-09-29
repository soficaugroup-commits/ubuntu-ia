import "server-only";
import { defaultDna, type DesignDna } from "@/lib/server/design-dna";
import type { DocumentSpec } from "@/lib/server/document-spec";
import { plainInline } from "@/lib/server/rich-text";

export function buildHtml(spec: DocumentSpec, dna: DesignDna = defaultDna()): Uint8Array {
  const primary = `#${dna.primary}`;
  const accent = `#${dna.accent}`;
  const canvas = `#${dna.canvas}`;
  const text = `#${dna.text}`;
  const sections = spec.sections
    .map((section) => {
      const body = section.body.map((line) => `<p>${esc(plainInline(line))}</p>`).join("");
      const bullets = section.bullets.length
        ? `<ul>${section.bullets.map((item) => `<li>${esc(plainInline(item))}</li>`).join("")}</ul>`
        : "";
      const numbered = section.numbered?.length
        ? `<ol>${section.numbered.map((item) => `<li>${esc(plainInline(item))}</li>`).join("")}</ol>`
        : "";
      const table = section.table
        ? `<table><thead><tr>${section.table.headers.map((cell) => `<th>${esc(plainInline(cell))}</th>`).join("")}</tr></thead><tbody>${section.table.rows
            .map(
              (row) =>
                `<tr>${section.table!.headers.map((_, index) => `<td>${esc(plainInline(row[index] ?? ""))}</td>`).join("")}</tr>`,
            )
            .join("")}</tbody></table>`
        : "";
      return `<section><h${section.level ?? 2}>${esc(plainInline(section.title))}</h${section.level ?? 2}>${section.quote ? `<blockquote>${esc(plainInline(section.quote))}</blockquote>` : ""}${body}${bullets}${numbered}${table}</section>`;
    })
    .join("");
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(plainInline(spec.title))}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: ${canvas}; color: ${text}; font-family: ${cssFont(dna.bodyFont)}; line-height: 1.5; }
  header, main { max-width: 46rem; margin: 0 auto; padding: 2rem 1.25rem; }
  header { background: ${primary}; color: #fff; }
  h1, h2, h3 { font-family: ${cssFont(dna.headingFont)}; line-height: 1.2; }
  header h1 { margin: 0 0 0.5rem; font-size: 2rem; }
  header p { margin: 0; color: ${accent}; }
  section { margin: 0 0 1.75rem; }
  table { width: 100%; border-collapse: collapse; background: #fff; }
  th, td { text-align: left; padding: 0.45rem 0.6rem; border-bottom: 1px solid ${canvas}; }
  th { background: ${primary}; color: #fff; }
  blockquote { margin: 0 0 1rem; padding-left: 0.8rem; border-left: 4px solid ${accent}; }
  a { color: ${primary}; }
</style>
</head>
<body>
<header>
  <h1>${esc(plainInline(spec.title))}</h1>
  ${spec.subtitle ? `<p>${esc(plainInline(spec.subtitle))}</p>` : ""}
</header>
<main>${sections}</main>
</body>
</html>`;
  return new TextEncoder().encode(html);
}

function cssFont(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9 \-]/g, "").trim() || "Calibri";
  return `"${safe}", "Segoe UI", sans-serif`;
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
