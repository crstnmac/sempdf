import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="brand-lockup">
          <span className="brand-mark" aria-hidden="true" />
          <span>zeropdf</span>
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
