"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { IconChevron, IconGlobe } from "@/components/ui/icons";
import { copy } from "@/content/fr";
import { hostnameFromUrl, isBareUrl } from "@/lib/answer-text";
import { interpolate } from "@/lib/format";
import type { SourceCitation } from "@/lib/types";

type Props = {
  messageId: string;
  sources: SourceCitation[];
};

export function SourceCitations({ messageId, sources }: Props) {
  if (!sources.length) return null;

  return (
    <section className="mt-5">
      <h3 className="text-sm font-semibold">{copy.chat.sourcesHeading}</h3>
      <ul className="mt-3 flex flex-col gap-3">
        {sources.map((source, index) => (
          <SourceItem
            key={`${source.documentId}-${index}-${source.extrait.slice(0, 24)}`}
            source={source}
            index={index}
            messageId={messageId}
          />
        ))}
      </ul>
    </section>
  );
}

function SourceItem({
  source,
  index,
  messageId,
}: {
  source: SourceCitation;
  index: number;
  messageId: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const n = index + 1;
  const sourceId = `source-${messageId}-${n}`;
  const name = interpolate(copy.chat.sourceToggle, {
    n: String(n),
    title: source.titre,
  });
  const host = source.url_source ? hostnameFromUrl(source.url_source) : "";
  const extract = source.extrait.trim();
  const showExtract = Boolean(extract) && !isBareUrl(extract);

  useEffect(() => {
    function openIfCited() {
      if (window.location.hash === `#${sourceId}` && detailsRef.current) {
        detailsRef.current.open = true;
      }
    }

    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.hash === `#${sourceId}` || link.getAttribute("href") === `#${sourceId}`) {
        if (detailsRef.current) detailsRef.current.open = true;
      }
    }

    openIfCited();
    window.addEventListener("hashchange", openIfCited);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", openIfCited);
      document.removeEventListener("click", onClick);
    };
  }, [sourceId]);

  return (
    <li id={sourceId} className="scroll-mt-6">
      <Surface elevation="pressed" radius="surface">
        <details ref={detailsRef} className="source-disclosure">
          <summary className="cursor-pointer text-content" aria-label={name}>
            <span className="flex items-start gap-3 px-4 py-3">
              <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-xs font-semibold">
                {n}
              </span>
              <span className="min-w-0 flex-1">
                <span className="source-disclosure-title text-sm font-semibold leading-snug">
                  {source.titre}
                </span>
                <span className="mt-1 block text-xs font-medium text-content-muted">
                  {source.origine === "web"
                    ? copy.chat.sourceWeb
                    : copy.chat.sourceIndex}
                  {host ? ` · ${host}` : ""}
                </span>
              </span>
              <span className="mt-0.5 flex shrink-0 items-center gap-1 text-content-muted">
                <span className="source-show text-xs font-semibold">
                  {copy.chat.sourceShow}
                </span>
                <span className="source-hide text-xs font-semibold">
                  {copy.chat.sourceHide}
                </span>
                <IconChevron className="source-chevron size-4" />
              </span>
            </span>
          </summary>
          <div className="source-disclosure-panel px-4 pb-4 pl-[3.25rem] pr-4">
            {showExtract ? (
              <>
                <p className="sr-only">{copy.chat.extractLabel}</p>
                <p className="text-sm leading-6 text-content-muted">{extract}</p>
              </>
            ) : null}
            {source.url_source ? (
              <div className={showExtract ? "mt-3" : ""}>
                <Button
                  type="button"
                  variant="secondary"
                  aria-label={interpolate(copy.chat.sourceOpenLabel, {
                    title: source.titre,
                  })}
                  tooltip={copy.chat.tipSourceOpen}
                  onClick={() =>
                    window.open(source.url_source ?? undefined, "_blank", "noopener,noreferrer")
                  }
                >
                  <IconGlobe className="size-4" />
                  {copy.chat.sourceOpen}
                </Button>
              </div>
            ) : null}
          </div>
        </details>
      </Surface>
    </li>
  );
}
