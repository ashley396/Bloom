/**
 * Florisyn design tokens — TypeScript reference for charts, status maps, and programmatic use.
 * CSS `@theme` in index.css is the single source of truth for visual values.
 */

export const colors = {
  warmWhite: "#fffcf8",
  warmCream: "#faf6ef",
  warmCreamDeep: "#f3ece3",
  warmIvory: "#fff9f2",
  blush500: "#d4a0b0",
  blush600: "#b88494",
  sageInk: "#5a6b60",
  sageMuted: "#7a9182",
  charcoal: "#2c2826",
  charcoalMuted: "#5a534e",
  success: "#5a7d62",
  warning: "#9a7b4f",
  destructive: "#b85c5c",
  info: "#5a7291",
} as const;

export const spacing = {
  touch: "2.75rem",
  pageX: "1.25rem",
  pageY: "2rem",
  section: "3rem",
  cardSm: "1.5rem",
  cardMd: "1.75rem",
  cardLg: "2rem",
} as const;

export const radii = {
  sm: "0.5rem",
  md: "0.75rem",
  lg: "1rem",
  xl: "1rem",
  "2xl": "1.375rem",
  "3xl": "1.75rem",
} as const;

/** Shared badge/status surface classes — use with Badge component variants where possible. */
export const statusSurfaces = {
  neutral: "bg-warm-cream-deep text-charcoal-muted",
  active: "bg-blush-50 text-charcoal",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info",
  destructive: "bg-destructive-soft text-destructive",
} as const;

export type StatusSurface = keyof typeof statusSurfaces;
