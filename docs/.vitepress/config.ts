import { readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { defineConfig, type DefaultTheme } from "vitepress";

const apiDir = join(process.cwd(), "docs", "api");

function titleFromFile(file: string): string {
  return basename(file, ".md")
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readApiGroup(folder: string, label: string): DefaultTheme.SidebarItem | undefined {
  const dir = join(apiDir, folder);

  try {
    const items = readdirSync(dir)
      .filter((file) => file.endsWith(".md"))
      .sort((left, right) => left.localeCompare(right))
      .map((file) => ({
        text: titleFromFile(file),
        link: `/api/${folder}/${basename(file, ".md")}`
      }));

    return items.length > 0 ? { text: label, collapsed: true, items } : undefined;
  } catch {
    return undefined;
  }
}

function readApiFolders(): DefaultTheme.SidebarItem[] {
  try {
    return readdirSync(apiDir)
      .filter((entry) => statSync(join(apiDir, entry)).isDirectory())
      .filter((entry) => !["classes", "enumerations", "functions", "interfaces", "type-aliases", "variables"].includes(entry))
      .sort((left, right) => left.localeCompare(right))
      .map((entry) => ({
        text: titleFromFile(entry),
        collapsed: true,
        items: readdirSync(join(apiDir, entry))
          .filter((file) => file.endsWith(".md"))
          .sort((left, right) => left.localeCompare(right))
          .map((file) => {
            const path = relative(join(process.cwd(), "docs"), join(apiDir, entry, file)).split(sep).join("/");
            return {
              text: titleFromFile(file),
              link: `/${path.replace(/\.md$/, "")}`
            };
          })
      }));
  } catch {
    return [];
  }
}

function apiSidebar(): DefaultTheme.SidebarItem[] {
  const knownGroups = [
    readApiGroup("classes", "Classes"),
    readApiGroup("interfaces", "Interfaces"),
    readApiGroup("functions", "Functions"),
    readApiGroup("type-aliases", "Type Aliases"),
    readApiGroup("enumerations", "Enumerations"),
    readApiGroup("variables", "Variables")
  ].filter((group): group is DefaultTheme.SidebarItem => Boolean(group));

  return [
    { text: "API Overview", link: "/api/" },
    ...knownGroups,
    ...readApiFolders()
  ];
}

export default defineConfig({
  title: "pdf-editing-lib",
  description: "Zero-dependency PDF generation and editing in TypeScript.",
  cleanUrls: true,
  lastUpdated: true,
  head: [["link", { rel: "icon", type: "image/svg+xml", href: "/logo.svg" }]],
  themeConfig: {
    logo: { src: "/logo.svg", alt: "pdf-editing-lib" },
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API", link: "/api/" },
      { text: "Examples", link: "/guide/browser-usage" }
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Introduction",
          items: [
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Browser Usage", link: "/guide/browser-usage" },
            { text: "Streaming and Output", link: "/guide/streaming-and-output" },
            { text: "Performance", link: "/guide/performance" }
          ]
        },
        {
          text: "Authoring",
          items: [
            { text: "Text and Fonts", link: "/guide/text-and-fonts" },
            { text: "Images", link: "/guide/images" },
            { text: "Forms and Annotations", link: "/guide/forms-and-annotations" },
            { text: "Metadata and Navigation", link: "/guide/metadata-and-navigation" },
            { text: "Report Templates", link: "/guide/report-templates" }
          ]
        },
        {
          text: "Cookbook",
          items: [
            { text: "Invoice", link: "/guide/cookbook-invoice" },
            { text: "Event Ticket", link: "/guide/cookbook-ticket" },
            { text: "Certificate", link: "/guide/cookbook-certificate" },
            { text: "Multi-Column Report", link: "/guide/cookbook-multi-column-report" }
          ]
        },
        {
          text: "Editing and Assembly",
          items: [
            { text: "Edit Existing PDFs", link: "/guide/edit-existing-pdfs" },
            { text: "Page Assembly", link: "/guide/page-assembly" }
          ]
        },
        {
          text: "Standards and Security",
          items: [
            { text: "Accessibility and Compliance", link: "/guide/accessibility-and-compliance" },
            { text: "PDF Versions and Conformance", link: "/guide/pdf-versions-and-conformance" },
            { text: "Encryption and Signatures", link: "/guide/encryption-and-signatures" },
            { text: "Security Hardening", link: "/guide/security-hardening" }
          ]
        },
        {
          text: "Support",
          items: [
            { text: "Troubleshooting", link: "/guide/troubleshooting" }
          ]
        }
      ],
      "/api/": apiSidebar()
    },
    search: {
      provider: "local"
    },
    socialLinks: [],
    footer: {
      message: "Released under the ISC license."
    }
  }
});
