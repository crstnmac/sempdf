import { useState } from "react";
import { GlobeIcon, PlusIcon, XIcon } from "lucide-react";

import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";

export const MAX_ORIGINS_PER_KEY = 8;

/**
 * Client-side mirror of the server's origin normalization: scheme://host[:port],
 * lowercased, no path. Returns null for anything that isn't a valid origin.
 * Extension schemes (chrome-extension://…) are supported.
 */
export function normalizeOrigin(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!url.host || url.username || url.password) return null;
  if (url.origin && url.origin !== "null") return url.origin.toLowerCase();
  return `${url.protocol}//${url.host}`.toLowerCase();
}

/** Controlled editor for a key's origin allowlist: chips + an add field. */
export function OriginsInput({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (origins: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    const normalized = normalizeOrigin(draft);
    if (!normalized) {
      setError("Enter a full origin, e.g. https://app.example.com or chrome-extension://<id>");
      return;
    }
    if (value.includes(normalized)) {
      setDraft("");
      setError(null);
      return;
    }
    if (value.length >= MAX_ORIGINS_PER_KEY) {
      setError(`At most ${MAX_ORIGINS_PER_KEY} origins per key.`);
      return;
    }
    onChange([...value, normalized]);
    setDraft("");
    setError(null);
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((origin) => (
            <Badge key={origin} variant="secondary" className="h-auto max-w-full py-0.5">
              <span className="truncate font-mono">{origin}</span>
              {!disabled ? (
                <button
                  type="button"
                  aria-label={`Remove ${origin}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => onChange(value.filter((o) => o !== origin))}
                >
                  <XIcon data-icon="inline-end" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <GlobeIcon className="size-3.5" />
          No restrictions — this key works from anywhere (including servers).
        </p>
      )}
      {!disabled ? (
        <>
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="https://app.example.com or chrome-extension://<id>"
              maxLength={200}
              aria-invalid={error ? true : undefined}
              className="font-mono text-xs sm:max-w-sm"
            />
            <Button type="button" variant="outline" size="sm" onClick={add} disabled={!draft.trim()}>
              <PlusIcon />
              Add
            </Button>
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </>
      ) : null}
    </div>
  );
}
