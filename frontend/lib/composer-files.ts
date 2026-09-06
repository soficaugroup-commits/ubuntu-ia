import {
  INDEXABLE_ACCEPT,
  INDEXABLE_EXTENSIONS,
  INDEXABLE_MIME_TYPES,
} from "@/lib/upload-files";

export const COMPOSER_MAX_FILES = 8;
export const COMPOSER_MAX_BYTES = 20 * 1024 * 1024;

const IMAGE_TYPES = new Set<string>(
  INDEXABLE_MIME_TYPES.filter((type) => type.startsWith("image/")),
);

export const COMPOSER_FILE_ACCEPT = INDEXABLE_ACCEPT;
export const COMPOSER_IMAGE_ACCEPT = [...IMAGE_TYPES].join(",");
export const COMPOSER_ANY_ACCEPT = INDEXABLE_ACCEPT;

export function isImageFile(file: File): boolean {
  if (IMAGE_TYPES.has(file.type)) return true;
  return /\.(png|jpe?g|gif|webp|tif|tiff|bmp)$/i.test(file.name);
}

export function isAllowedComposerFile(file: File): boolean {
  if (isImageFile(file)) return true;
  const lower = file.name.toLowerCase();
  return INDEXABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
