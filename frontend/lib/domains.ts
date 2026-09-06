export type AllowedDomain = {
  id: string;
  domaine: string;
  date_ajout: string;
};

const DOMAIN_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function normalizeDomain(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (value.startsWith("@")) value = value.slice(1);
  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      value = new URL(raw.trim()).hostname.toLowerCase();
    } catch {
      return value;
    }
  }
  return value;
}

export function isValidDomain(domaine: string): boolean {
  return DOMAIN_PATTERN.test(domaine);
}

export function emailDomain(email: string): string | null {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain || null;
}

export function formatAllowedDomains(domains: string[]): string {
  const labels = domains.map((item) => `@${item}`);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} et ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} et ${labels[labels.length - 1]}`;
}
