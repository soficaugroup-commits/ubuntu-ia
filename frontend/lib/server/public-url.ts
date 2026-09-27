import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google",
]);

function isPublicIp(ip: string): boolean {
  if (ip.startsWith("::ffff:")) {
    return isPublicIp(ip.slice(7));
  }
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) {
      return false;
    }
    return true;
  }
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a >= 224) return false;
  return true;
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("Indiquez une URL http ou https complète.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Indiquez une URL http ou https complète.");
  }
  const host = parsed.hostname.toLowerCase();
  if (!host || BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Cette adresse n'est pas autorisée.");
  }
  if (isIP(host)) {
    if (!isPublicIp(host)) {
      throw new Error("Les adresses internes ou privées ne sont pas autorisées.");
    }
    return parsed;
  }
  const records = await lookup(host, { all: true, verbatim: true });
  if (!records.length) {
    throw new Error(`Nom d'hôte inaccessible : ${host}`);
  }
  for (const record of records) {
    if (!isPublicIp(record.address)) {
      throw new Error("Les adresses internes ou privées ne sont pas autorisées.");
    }
  }
  return parsed;
}
