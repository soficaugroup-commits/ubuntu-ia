import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "md" | "icon";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  pending?: boolean;
};

const variants: Record<Variant, string> = {
  primary: "bg-brand text-inverse neo-bubble hover:bg-brand-hover",
  secondary: "neo-raised text-content",
  danger: "bg-accent text-brand neo-gold hover:bg-accent-hover hover:text-inverse",
  ghost: "bg-transparent text-content",
};

const sizes: Record<Size, string> = {
  md: "min-h-11 px-5 py-2",
  icon: "size-11 min-h-11 min-w-11 p-0",
};

export function Button({
  variant = "primary",
  size = "md",
  pending = false,
  className = "",
  disabled,
  children,
  ...props
}: Props) {
  return (
    <button
      {...props}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
