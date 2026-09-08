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
