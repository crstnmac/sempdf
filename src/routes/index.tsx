import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { ArrowRight, ArrowUpRight, Check, Copy, FileCheck2, Files, PenTool } from "lucide-react";
import { useState } from "react";
import { LiquidMetalMark } from "@/components/liquid-metal-mark";
import { baseOptions } from "@/lib/layout.shared";

export const Route = createFileRoute("/")({ component: Home });

function HighlightedExample() {
  return (
    <code>
      <span className="syntax-keyword">import</span> {"{ "}
      <span className="syntax-function">createDocument</span>
      {" } "}<span className="syntax-keyword">from</span>{" "}
      <span className="syntax-string">"@crstnmac/zeropdf"</span>;
      {"\n\n"}<span className="syntax-keyword">const</span> doc = <span className="syntax-function">createDocument</span>({"{ "}
      <span className="syntax-property">title</span>: <span className="syntax-string">"Invoice"</span>{" });"}
      {"\n"}<span className="syntax-keyword">const</span> page = doc.<span className="syntax-function">addPage</span>({"{ "}
      <span className="syntax-property">size</span>: <span className="syntax-string">"A4"</span>{" });"}
      {"\n\n"}page.<span className="syntax-function">text</span>(<span className="syntax-string">"Invoice #1007"</span>, {"{ "}
      <span className="syntax-property">x</span>: <span className="syntax-number">56</span>, <span className="syntax-property">y</span>: <span className="syntax-number">780</span>{" });"}
      {"\n\n"}<span className="syntax-keyword">const</span> bytes = doc.<span className="syntax-function">toUint8Array</span>();
    </code>
  );
}

function InstallCommand() {
  const [copied, setCopied] = useState(false);

  async function copyInstallCommand() {
    await navigator.clipboard.writeText("npm i @crstnmac/zeropdf");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button className="install-command" type="button" onClick={copyInstallCommand}>
      <code>npm i @crstnmac/zeropdf</code>
      <span aria-live="polite">
        {copied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
        <span className="sr-only">{copied ? "Copied" : "Copy install command"}</span>
      </span>
    </button>
  );
}

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="home-shell">
        <section className="home-hero">
          <div className="home-copy">
            <h1>Own every byte of your PDF.</h1>
            <p>
              Generate, inspect, tag, encrypt, merge, and edit PDF files directly in TypeScript—without
              handing document creation to a runtime dependency.
            </p>
            <div className="home-actions">
              <Link to="/$" params={{ _splat: "guide/getting-started" }} className="home-primary">
                Read the guide <ArrowRight aria-hidden="true" size={17} />
              </Link>
              <Link to="/playground" className="home-secondary">
                Try the playground <ArrowUpRight aria-hidden="true" size={17} />
              </Link>
            </div>
            <InstallCommand />
          </div>

          <div className="home-output" aria-label="TypeScript source producing PDF bytes">
            <div className="home-output-signal">
              <LiquidMetalMark variant="hero" />
              <strong className="home-output-brand">zeropdf</strong>
            </div>
            <div className="home-output-bar">
              <span>invoice.ts</span>
              <span>zero runtime dependencies</span>
            </div>
            <pre>
              <HighlightedExample />
            </pre>
            <div className="home-output-result">
              <span><i aria-hidden="true" /> Uint8Array ready</span>
              <Link to="/$" params={{ _splat: "api" }}>
                Explore the API <ArrowRight aria-hidden="true" size={15} />
              </Link>
            </div>
          </div>
        </section>

        <section className="home-lifecycle" aria-labelledby="lifecycle-title">
          <div className="home-lifecycle-heading">
            <h2 id="lifecycle-title">One engine. The whole document lifecycle.</h2>
            <p>Start from a blank page or an existing file, then carry the same document through production and proofing.</p>
          </div>
          <div className="home-lifecycle-flow">
            <article>
              <span className="home-step">Create</span>
              <PenTool aria-hidden="true" />
              <h3>Lay out precise documents</h3>
              <p>Place text and vector paths, embed images, attach files, and serialize deterministic bytes.</p>
              <Link to="/$" params={{ _splat: "guide/getting-started" }}>Generation guide <ArrowRight aria-hidden="true" size={15} /></Link>
            </article>
            <article>
              <span className="home-step">Modify</span>
              <Files aria-hidden="true" />
              <h3>Work with existing PDFs</h3>
              <p>Update metadata and forms, append overlays, reorder pages, and preserve incremental history.</p>
              <Link to="/$" params={{ _splat: "guide/edit-existing-pdfs" }}>Editing guide <ArrowRight aria-hidden="true" size={15} /></Link>
            </article>
            <article>
              <span className="home-step">Prove</span>
              <FileCheck2 aria-hidden="true" />
              <h3>Ship accessible output</h3>
              <p>Create tagged PDFs with semantic flow, structure trees, alt text, and validation warnings.</p>
              <Link to="/$" params={{ _splat: "guide/accessibility-and-compliance" }}>Accessibility guide <ArrowRight aria-hidden="true" size={15} /></Link>
            </article>
          </div>
        </section>

        <section className="home-next" aria-labelledby="next-title">
          <div>
            <h2 id="next-title">Start with a page. Leave with a PDF.</h2>
            <p>The playground puts editable document source beside its rendered output.</p>
          </div>
          <Link to="/playground">
            Open the playground <ArrowUpRight aria-hidden="true" size={18} />
          </Link>
        </section>
      </main>
    </HomeLayout>
  );
}
