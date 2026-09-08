"use client";

type IconProps = {
  className?: string;
};

const base = "size-5 shrink-0";

export function IconPlus({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconPaperclip({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M8.5 12.5 15 6a3.2 3.2 0 1 1 4.5 4.5l-8.8 8.8a4.5 4.5 0 0 1-6.4-6.4l8.2-8.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconImage({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="4" y="5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="9" cy="10" r="1.4" fill="currentColor" />
      <path
        d="m7 16 3.2-3.2a1 1 0 0 1 1.4 0L16 17l1.3-1.3a1 1 0 0 1 1.4 0L20 17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconCamera({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M8 8 9.2 6.2A1.5 1.5 0 0 1 10.4 5.5h3.2A1.5 1.5 0 0 1 14.8 6.2L16 8h2.5A2.5 2.5 0 0 1 21 10.5v6A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-6A2.5 2.5 0 0 1 5.5 8H8Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function IconSearch({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconGlobe({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M4 12h16M12 4c2.5 2.4 3.8 5.2 3.8 8S14.5 17.6 12 20C9.5 17.6 8.2 14.8 8.2 12S9.5 6.4 12 4Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function IconSparkle({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 4.5 13.2 9 18 10.2 13.2 11.4 12 16l-1.2-4.6L6 10.2 10.8 9 12 4.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconResearch({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M7 5h7l3 3v11H7V5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9.5 12h5M9.5 15h3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconCanvas({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="4" y="5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 15h8M8 11h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconMic({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="9" y="4" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconWave({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M5 12v0M8 8v8M12 5v14M16 8v8M19 12v0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconSend({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M5 12 19 5l-4.5 14-3.2-5.3L5 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconStop({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
    </svg>
  );
}

export function IconTrash({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7M8 7v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconClose({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="m7 7 10 10M17 7 7 17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconMenu({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M5 7h14M5 12h14M5 17h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconHistory({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M7 7h10v12H7z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9.5 4.5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconCopy({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect
        x="8"
        y="8"
        width="11"
        height="13"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconPencil({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M4 20h4.5L19 9.5a2.1 2.1 0 0 0-3-3L5.5 17.5V20Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M14.5 6.5 17.5 9.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconCheck({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="m6.5 12 3.8 3.8 7.2-7.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconDownload({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 4v10m0 0 4-4m-4 4-4-4M5 18h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconFile({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M8 4h6l4 4v12H8V4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconThumbUp({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M8 11v8H5.8A1.8 1.8 0 0 1 4 17.2v-4.4A1.8 1.8 0 0 1 5.8 11H8Zm0 0 3.2-6.2A1.8 1.8 0 0 1 12.8 3.6c.9 0 1.6.8 1.5 1.7L14 9h4.4a2 2 0 0 1 2 2.3l-.8 6A2 2 0 0 1 17.6 19H8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconThumbDown({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M16 13V5h2.2A1.8 1.8 0 0 1 20 6.8v4.4A1.8 1.8 0 0 1 18.2 13H16Zm0 0-3.2 6.2a1.8 1.8 0 0 1-1.6 1.2c-.9 0-1.6-.8-1.5-1.7L10 15H5.6a2 2 0 0 1-2-2.3l.8-6A2 2 0 0 1 6.4 5H16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconMemory({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M8 5h8l2 3v11H6V8l2-3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9 11h6M9 15h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconChevron({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="m6 9 6 6 6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
