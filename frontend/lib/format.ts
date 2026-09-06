const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
});

export function formatDateTime(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

export function interpolate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}
