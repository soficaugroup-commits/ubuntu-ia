export const INDEXABLE_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".doc",
  ".txt",
  ".md",
  ".csv",
  ".xlsx",
  ".xlsm",
  ".xls",
  ".pptx",
  ".ppt",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".tif",
  ".tiff",
  ".bmp",
] as const;

export const INDEXABLE_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroEnabled.12",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/tiff",
  "image/bmp",
] as const;

export const INDEXABLE_ACCEPT = [
  ...INDEXABLE_EXTENSIONS,
  ...INDEXABLE_MIME_TYPES,
].join(",");

export function fileExtension(name: string): string | null {
  const ext = name.includes(".")
    ? `.${name.split(".").pop()?.toLowerCase()}`
    : "";
  return (INDEXABLE_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}
