export const INDEXABLE_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".csv",
  ".xlsx",
  ".xlsm",
  ".xls",
  ".pptx",
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
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroEnabled.12",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
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
