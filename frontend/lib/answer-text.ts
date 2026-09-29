const MARKDOWN_IMAGE = /!\[[^\]]*]\(\s*<?[^)\s]+(?:"[^"]*")?>?\s*\)/g;
const MARKDOWN_LINK = /\[([^\]]+)\]\(\s*<?([^)\s]+)(?:"[^"]*")?>?\s*\)/g;
const ANGLE_URL = /<https?:\/\/[^>\s]+>/gi;
const BARE_URL = /https?:\/\/[^\s<>\]\)"'`]+/gi;
const DOMAIN_PARENS =
  /\(\s*(?:www\.)?[a-z0-9][-a-z0-9]*(?:\.[a-z0-9][-a-z0-9]*)+(?:\/[^\s)]*)?\s*\)/gi;

function isUrlLikeLabel(label: string): boolean {
  const value = label.trim();
  if (!value) return true;
  if (/^\d+$/.test(value)) return false;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^www\./i.test(value)) return true;
  if (/\.(pdf|docx?|xlsx?|pptx?|html?|zip)(?:[?#].*)?$/i.test(value)) return true;
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[\w./?%&=+-]*)?$/i.test(value);
}

const SPEC_FENCE = /```(?:ubuntu-ia-doc|json)\s*([\s\S]*?)```/gi;

/** Retire le bloc technique de design. Le fichier l'utilise encore, le chat non. */
export function stripDocumentSpec(content: string): string {
  if (!content) return content;
  return content
    .replace(SPEC_FENCE, (full, body: string) => (isDocumentSpec(full, body) ? "" : full))
    .replace(/```ubuntu-ia-doc[\s\S]*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isDocumentSpec(full: string, body: string): boolean {
  if (/```ubuntu-ia-doc/i.test(full)) return true;
  const text = body.trim();
  if (!text.startsWith("{")) return false;
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    return Boolean(raw.design || raw.miseEnForme || raw.titre || raw.title || raw.sections || raw.primaire);
  } catch {
    return /"(?:design|miseEnForme|titre|title|primaire|policeTitre)"/.test(text);
  }
}

/**
 * Masque le bloc ubuntu-ia-doc au fil de l'eau, pour qu'il n'apparaisse pas pendant la frappe.
 */
export function createVisibleAnswerFilter() {
  let hold = "";
  let mode: "text" | "spec" | "maybe-json" | "code" = "text";

  const take = (next: string) => {
    hold = next;
  };

  return {
    push(chunk: string): string {
      hold += chunk;
      let visible = "";
      while (hold) {
        if (mode === "text") {
          const tick = hold.indexOf("```");
          if (tick < 0) {
            const trail = /`{1,2}$/.exec(hold);
            if (trail) {
              visible += hold.slice(0, -trail[0].length);
              take(trail[0]);
            } else {
              visible += hold;
              take("");
            }
            break;
          }
          visible += hold.slice(0, tick);
          hold = hold.slice(tick);
          const lineEnd = hold.indexOf("\n");
          if (lineEnd < 0) break;
          const lang = hold.slice(3, lineEnd).trim().toLowerCase();
          if (lang === "ubuntu-ia-doc") {
            mode = "spec";
            hold = hold.slice(lineEnd + 1);
          } else if (lang === "json") {
            mode = "maybe-json";
            hold = hold.slice(lineEnd + 1);
          } else {
            visible += hold.slice(0, lineEnd + 1);
            hold = hold.slice(lineEnd + 1);
            mode = "code";
          }
          continue;
        }
        const end = hold.indexOf("```");
        if (mode === "code") {
          if (end < 0) {
            visible += hold;
            take("");
            break;
          }
          visible += hold.slice(0, end + 3);
          hold = hold.slice(end + 3);
          mode = "text";
          continue;
        }
        if (end < 0) break;
        const body = hold.slice(0, end);
        if (mode === "maybe-json" && !isDocumentSpec("```json", body)) {
          visible += `\`\`\`json\n${body}\`\`\``;
        }
        hold = hold.slice(end + 3);
        mode = "text";
      }
      return visible;
    },
    finish(): string {
      if (mode === "text" || mode === "code") {
        const rest = hold;
        hold = "";
        mode = "text";
        return rest;
      }
      if (mode === "maybe-json" && !isDocumentSpec("```json", hold)) {
        const rest = `\`\`\`json\n${hold}`;
        hold = "";
        mode = "text";
        return rest;
      }
      hold = "";
      mode = "text";
      return "";
    },
  };
}

export function stripInlineLinks(content: string): string {
  if (!content) return content;
  return content
    .replace(/\r\n/g, "\n")
    .split(/(```[\s\S]*?```)/g)
    .map((part) => (part.startsWith("```") ? part : stripProseLinks(part)))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripProseLinks(content: string): string {
  let text = content;
  text = text.replace(MARKDOWN_IMAGE, "");
  text = text.replace(MARKDOWN_LINK, (_full, label: string) => {
    const trimmed = String(label).trim();
    if (/^\d+$/.test(trimmed)) return `[${trimmed}]`;
    return isUrlLikeLabel(trimmed) ? "" : trimmed;
  });
  text = text.replace(ANGLE_URL, "");
  text = text.replace(BARE_URL, "");
  text = text.replace(/\(\s*\)/g, "");
  text = text.replace(/\[\s*\]/g, "");
  text = text.replace(DOMAIN_PARENS, "");
  text = text.replace(/[ \t]+([.,;:!?])/g, "$1");
  text = text.replace(/[ \t]{2,}/g, " ");
  text = text.replace(/[ \t]+\n/g, "\n");
  return text;
}

export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isBareUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}
