import type { ReactNode } from "react";

type Props = {
  label: string;
  children: ReactNode;
  className?: string;
};

export function Tooltip({ label, children, className = "" }: Props) {
  return (
    <span className={`relative inline-flex group/tooltip ${className}`.trim()}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+0.4rem)] left-1/2 z-50 hidden w-max max-w-56 -translate-x-1/2 group-hover/tooltip:block group-focus-within/tooltip:block"
      >
        <span className="neo-raised inline-block rounded-surface px-3 py-2 text-center text-xs font-medium leading-5 text-content">
          {label}
        </span>
      </span>
    </span>
  );
}
