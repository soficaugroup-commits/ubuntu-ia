import { isValidElement, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Tooltip } from "@/components/ui/Tooltip";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "md" | "icon";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  pending?: boolean;
  tooltip?: string;
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

function labelFromChildren(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    return node.map(labelFromChildren).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  if (isValidElement<{ children?: ReactNode }>(node) && node.props.children != null) {
    return labelFromChildren(node.props.children);
  }
  return "";
}

export function Button({
  variant = "primary",
  size = "md",
  pending = false,
  tooltip,
  className = "",
  disabled,
  children,
  title,
  ...props
}: Props) {
  const described =
    tooltip?.trim() ||
    title?.trim() ||
    (typeof props["aria-label"] === "string" ? props["aria-label"].trim() : "") ||
    labelFromChildren(children);

  const button = (
    <button
      {...props}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold transition-[color,background-color,box-shadow,transform,filter] disabled:cursor-not-allowed disabled:opacity-60 ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );

  if (!described) return button;

  const wrapperClass = className
    .split(/\s+/)
    .filter((token) =>
      /^(?:[a-z0-9]+:)?(?:hidden|block|flex|inline-flex|ml-auto|mr-auto|mx-auto|w-full)$/.test(
        token,
      ),
    )
    .join(" ");

  return (
    <Tooltip label={described} className={wrapperClass || undefined}>
      {button}
    </Tooltip>
  );
}
