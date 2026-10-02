import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Button } from "./Button.vue"

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-button)] text-xs font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[var(--color-button-bg)] text-[var(--color-button-fg)] hover:bg-[var(--color-button-bg-hover)] active:bg-[var(--color-button-bg-pressed)]",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-[var(--color-border-strong)] bg-[var(--color-button-outline-bg)] text-[var(--color-button-outline-fg)] hover:bg-[var(--color-button-outline-hover)]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-[var(--color-accent)] underline-offset-4 hover:underline",
      },
      size: {
        "default": "h-8 px-3 py-1.5",
        "sm": "h-7 rounded-[var(--radius-button)] px-2.5",
        "lg": "h-9 rounded-[var(--radius-button)] px-5",
        "icon": "h-8 w-8",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export type ButtonVariants = VariantProps<typeof buttonVariants>
