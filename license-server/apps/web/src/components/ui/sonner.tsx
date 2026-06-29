"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      richColors
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--border-radius": "var(--radius)",
          // Neutral toast → popover surface.
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          // Typed toasts → app semantic tokens (richColors reads these vars).
          "--success-bg": "var(--color-success-surface)",
          "--success-text": "var(--color-success)",
          "--success-border": "color-mix(in oklab, var(--color-success) 30%, transparent)",
          "--error-bg": "var(--color-danger-surface)",
          "--error-text": "var(--color-danger)",
          "--error-border": "color-mix(in oklab, var(--color-danger) 30%, transparent)",
          "--warning-bg": "var(--color-warning-surface)",
          "--warning-text": "var(--color-warning)",
          "--warning-border": "color-mix(in oklab, var(--color-warning) 30%, transparent)",
          "--info-bg": "var(--color-accent)",
          "--info-text": "var(--color-accent-foreground)",
          "--info-border": "color-mix(in oklab, var(--color-accent-foreground) 25%, transparent)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
