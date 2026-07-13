import * as React from "react"

import { cn } from "#/lib/utils.ts"

type Orientation = "vertical" | "horizontal" | "both"

type Edges = { top: boolean; bottom: boolean; left: boolean; right: boolean }

const NO_EDGES: Edges = { top: false, bottom: false, left: false, right: false }

function computeEdges(el: HTMLElement, orientation: Orientation): Edges {
  const vertical = orientation === "vertical" || orientation === "both"
  const horizontal = orientation === "horizontal" || orientation === "both"
  // 1px slack absorbs sub-pixel rounding so the fade fully clears at the ends.
  return {
    top: vertical && el.scrollTop > 1,
    bottom: vertical && el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    left: horizontal && el.scrollLeft > 1,
    right: horizontal && el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
  }
}

function maskFor(edges: Edges, orientation: Orientation, size: number): string | undefined {
  const layers: string[] = []
  if (orientation === "vertical" || orientation === "both") {
    const start = edges.top ? size : 0
    const end = edges.bottom ? size : 0
    if (start || end) {
      layers.push(
        `linear-gradient(to bottom, transparent 0, #000 ${start}px, #000 calc(100% - ${end}px), transparent 100%)`,
      )
    }
  }
  if (orientation === "horizontal" || orientation === "both") {
    const start = edges.left ? size : 0
    const end = edges.right ? size : 0
    if (start || end) {
      layers.push(
        `linear-gradient(to right, transparent 0, #000 ${start}px, #000 calc(100% - ${end}px), transparent 100%)`,
      )
    }
  }
  return layers.length ? layers.join(", ") : undefined
}

/**
 * Tracks which edges of a scroll container still have content past them and
 * returns a `mask-image` style that fades exactly those edges. Recomputes on
 * scroll and on size changes (container or content).
 */
export function useScrollFade<T extends HTMLElement>(
  orientation: Orientation = "vertical",
  size = 24,
) {
  const ref = React.useRef<T>(null)
  const [edges, setEdges] = React.useState<Edges>(NO_EDGES)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setEdges(computeEdges(el, orientation))
    update()
    el.addEventListener("scroll", update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => {
      el.removeEventListener("scroll", update)
      ro.disconnect()
    }
  }, [orientation])

  const mask = maskFor(edges, orientation, size)
  const style: React.CSSProperties = mask
    ? { maskImage: mask, WebkitMaskImage: mask, maskComposite: "intersect" }
    : {}

  return { ref, style }
}

/**
 * Scroll container that fades content toward whichever edges still overflow.
 * The fade clears automatically when an edge is reached.
 */
function ScrollFade({
  className,
  orientation = "vertical",
  size = 24,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  orientation?: Orientation
  size?: number
}) {
  const fade = useScrollFade<HTMLDivElement>(orientation, size)
  return (
    <div
      ref={fade.ref}
      data-slot="scroll-fade"
      data-orientation={orientation}
      className={cn(
        orientation === "horizontal"
          ? "overflow-x-auto"
          : orientation === "both"
            ? "overflow-auto"
            : "overflow-y-auto",
        className,
      )}
      style={{ ...fade.style, ...style }}
      {...props}
    >
      {children}
    </div>
  )
}

export { ScrollFade }
