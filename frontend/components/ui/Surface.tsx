import { forwardRef, type HTMLAttributes } from "react";

type Elevation = "raised" | "soft" | "pressed" | "bubble" | "gold";
type Radius = "surface" | "bubble" | "card" | "pill";
type Tag = "div" | "section" | "article" | "aside" | "header";

type Props = HTMLAttributes<HTMLDivElement> & {
  elevation?: Elevation;
  radius?: Radius;
  as?: Tag;
};

const elevations: Record<Elevation, string> = {
  raised: "neo-raised",
  soft: "neo-soft",
  pressed: "neo-pressed",
  bubble: "neo-bubble",
  gold: "neo-gold",
};

const radii: Record<Radius, string> = {
  surface: "rounded-surface",
  bubble: "rounded-bubble",
  card: "rounded-card",
  pill: "rounded-full",
};

export const Surface = forwardRef<HTMLDivElement, Props>(function Surface(
  {
    elevation = "raised",
    radius = "card",
    as: Tag = "div",
    className = "",
    ...props
  },
  ref,
) {
  return (
    <Tag
      ref={ref}
      className={`${elevations[elevation]} ${radii[radius]} ${className}`}
      {...props}
    />
  );
});
