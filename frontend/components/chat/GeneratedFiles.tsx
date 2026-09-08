"use client";

import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { IconDownload, IconFile } from "@/components/ui/icons";
import { copy } from "@/content/fr";
import type { GeneratedFile, GeneratedImage } from "@/lib/types";

type Props = {
  files?: GeneratedFile[];
  images?: GeneratedImage[];
};

export function GeneratedFiles({ files, images }: Props) {
  const hasFiles = Boolean(files?.length);
  const hasImages = Boolean(images?.length);
  if (!hasFiles && !hasImages) return null;

  return (
    <div className="mt-4 flex flex-col gap-3">
      {hasImages ? (
        <ul className="flex flex-col gap-3">
          {images?.map((image, index) => (
            <li key={`img-${index}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={image.alt || copy.chat.generatedImageAlt}
                className="max-h-[28rem] w-full rounded-surface object-contain"
              />
              <div className="mt-2">
                <DownloadLink
                  href={image.url}
                  name={fileNameFromImage(image.alt, index)}
                  label={copy.chat.downloadImage}
                  tooltip={copy.chat.tipDownloadImage}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {hasFiles ? (
        <div>
          <p className="mb-2 text-sm font-semibold">{copy.chat.filesHeading}</p>
          <ul className="flex flex-col gap-2">
            {files?.map((file) => (
              <li key={file.id}>
                <Surface
                  elevation="pressed"
                  radius="surface"
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <IconFile />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{file.name}</span>
                    <span className="text-xs text-content-muted">
                      {copy.chat.fileKind[file.format] ?? file.format.toUpperCase()}
                    </span>
                  </span>
                  <DownloadLink
                    href={file.url}
                    name={file.name}
                    label={copy.chat.downloadFile}
                    tooltip={copy.chat.tipDownloadFile}
                  />
                </Surface>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function DownloadLink({
  href,
  name,
  label,
  tooltip,
}: {
  href: string;
  name: string;
  label: string;
  tooltip: string;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      tooltip={tooltip}
      onClick={() => {
        const link = document.createElement("a");
        link.href = href;
        link.download = name;
        link.rel = "noopener";
        document.body.append(link);
        link.click();
        link.remove();
      }}
    >
      <IconDownload />
      {label}
    </Button>
  );
}

function fileNameFromImage(alt: string, index: number): string {
  const stem = alt.trim() ? alt.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40) : "image-ubuntu-ia";
  return `${stem || "image-ubuntu-ia"}${index ? `-${index + 1}` : ""}.jpg`;
}
