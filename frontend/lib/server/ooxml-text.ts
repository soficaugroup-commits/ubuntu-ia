/**
 * Outils texte pour les parties XML Office : balises `{{champ}}` coupées entre plusieurs runs,
 * remplacement des balises, échappement. Fonctions pures, sans dépendance serveur.
 */

/** `{{champ}}`, `{{#boucle}}`, `{{/boucle}}` — espaces tolérés à l'intérieur des accolades. */
export const TAG_PATTERN = /\{\{\s*([#/]?)\s*([^{}]+?)\s*\}\}/g;

export function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

export function encodeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Clé de comparaison : minuscules, sans accents, mots séparés par un tiret bas. */
export function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function textNodePattern(tag: string): RegExp {
  return new RegExp(`(<${tag}(?:\\s[^>]*)?>)([\\s\\S]*?)(</${tag}>)`, "g");
}

function blockPattern(tag: string): RegExp {
  return new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "g");
}

/**
 * Regroupe dans un seul nœud texte chaque balise répartie sur plusieurs runs
 * (Word coupe souvent `{{nom}}` en `{{`, `nom`, `}}` à cause de la correction orthographique).
 * Le texte global du paragraphe est inchangé ; seuls les découpages bougent.
 */
export function mergeSplitTags(xml: string, block: string, text: string): string {
  const nodePattern = textNodePattern(text);
  return xml.replace(blockPattern(block), (paragraph) => {
    const nodes = [...paragraph.matchAll(nodePattern)];
    if (nodes.length < 2) return paragraph;
    const texts = nodes.map((node) => decodeXml(node[2]));
    const full = texts.join("");
    if (!full.includes("{{")) return paragraph;
    let changed = false;
    for (const match of full.matchAll(TAG_PATTERN)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const offsets = prefixOffsets(texts);
      const first = nodeAt(offsets, texts, start);
      const last = nodeAt(offsets, texts, end - 1);
      if (first === last) continue;
      let moved = "";
      for (let index = first + 1; index <= last; index += 1) {
        const take = index < last ? texts[index] : texts[index].slice(0, end - offsets[index]);
        moved += take;
        texts[index] = texts[index].slice(take.length);
      }
      texts[first] += moved;
      changed = true;
    }
    if (!changed) return paragraph;
    let cursor = 0;
    return paragraph.replace(nodePattern, (_full, open: string, _body: string, close: string) => {
      const value = texts[cursor] ?? "";
      cursor += 1;
      return `${preserveSpace(open, text)}${encodeXml(value)}${close}`;
    });
  });
}

function prefixOffsets(texts: string[]): number[] {
  const offsets: number[] = [];
  let sum = 0;
  for (const text of texts) {
    offsets.push(sum);
    sum += text.length;
  }
  return offsets;
}

function nodeAt(offsets: number[], texts: string[], position: number): number {
  for (let index = offsets.length - 1; index >= 0; index -= 1) {
    if (position >= offsets[index] && texts[index].length > 0) return index;
  }
  return 0;
}

function preserveSpace(open: string, tag: string): string {
  if (tag === "a:t" || /xml:space=/.test(open)) return open;
  return open.replace(/>$/, ' xml:space="preserve">');
}

/** Toutes les balises présentes (texte des nœuds concaténés par paragraphe). */
export function collectTags(xml: string, block: string, text: string): string[] {
  const nodePattern = textNodePattern(text);
  const found: string[] = [];
  for (const paragraph of xml.match(blockPattern(block)) ?? []) {
    const full = [...paragraph.matchAll(nodePattern)].map((node) => decodeXml(node[2])).join("");
    for (const match of full.matchAll(TAG_PATTERN)) {
      found.push(`${match[1]}${match[2].trim()}`);
    }
  }
  return found;
}

export type TagResolver = (name: string) => string | undefined;

/**
 * Remplace les balises simples dans chaque nœud texte. `lineBreak` sert à rendre les sauts de ligne
 * (ex. `</w:t><w:br/><w:t xml:space="preserve">` pour Word) ; sinon ils deviennent des espaces.
 */
export function replaceTags(
  xml: string,
  text: string,
  resolve: TagResolver,
  options: { lineBreak?: string; missing?: (name: string) => string } = {},
): string {
  return xml.replace(textNodePattern(text), (full, open: string, body: string, close: string) => {
    const decoded = decodeXml(body);
    if (!decoded.includes("{{")) return full;
    let out = "";
    let cursor = 0;
    let touched = false;
    for (const match of decoded.matchAll(TAG_PATTERN)) {
      if (match[1]) continue;
      const index = match.index ?? 0;
      out += encodeXml(decoded.slice(cursor, index));
      const value = resolve(match[2].trim()) ?? options.missing?.(match[2].trim()) ?? "";
      out += encodeValue(value, options.lineBreak);
      cursor = index + match[0].length;
      touched = true;
    }
    if (!touched) return full;
    out += encodeXml(decoded.slice(cursor));
    return `${preserveSpace(open, text)}${out}${close}`;
  });
}

function encodeValue(value: string, lineBreak?: string): string {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  if (lines.length === 1) return encodeXml(value);
  return lineBreak ? lines.map(encodeXml).join(lineBreak) : encodeXml(lines.join(" "));
}

/** Texte brut d'un bloc (paragraphe, ligne de tableau…). */
export function blockText(xml: string, text: string): string {
  return [...xml.matchAll(textNodePattern(text))].map((node) => decodeXml(node[2])).join("");
}
