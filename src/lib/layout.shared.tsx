import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { LiquidMetalMark } from "@/components/liquid-metal-mark";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="brand-lockup">
          <LiquidMetalMark />
          <span>sempdf</span>
        </span>
      ),
    },
    links: [
      { text: "Guide", url: "/guide/getting-started" },
      { text: "API", url: "/api/" },
      { text: "Examples", url: "/guide/examples" },
      { text: "Changelog", url: "/changelog" },
      { text: "Playground", url: "/playground" },
    ],
  };
}
