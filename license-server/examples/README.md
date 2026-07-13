# License enforcement demos

Runnable examples showing how `@sempdf/sempdf-pdf` generates PDFs and how
the licensing guard governs that generation. They use the core library from this
monorepo (`../../src`) directly via `tsx`, so no build step is required.

Demos 1–3 are **self-contained** (no server needed) — they install in-process
guards to demonstrate each enforcement behavior deterministically. Demos 4 and 5
run the **real** auto-guard against a running license server, so the watermark
and limits come from the license itself, not from app code.

| # | File | Shows |
|---|------|-------|
| 1 | `01-no-license.ts` | Fail-closed: no license ⇒ generation refused (`LICENSE_REQUIRED`). |
| 2 | `02-dev-bypass.ts` | `SEMPDF_LICENSE_DEV=1` bypass for local dev/CI. |
| 3 | `03-custom-guard-quota.ts` | Page metering + **hard block at the limit** (no grace). |
| 4 | `04-trial-watermark.ts` | **Trial watermark applied by the license** (server-driven, not hardcoded). |
| 5 | `05-live-server.ts` | End-to-end auto-guard: authorize/usage, telemetry, 90/95/100% alerts, block. |

## Running

From the `license-server` directory:

```bash
npx tsx examples/01-no-license.ts
npx tsx examples/02-dev-bypass.ts
npx tsx examples/03-custom-guard-quota.ts
```

Generated PDFs are written to `examples/out/`.

### Demos 4 & 5 (live server)

Demo 4 needs a **trial** key (the server returns the watermark); demo 5 shows
metering and the hard block (use any key — a trial caps at its page limit too).

1. Start the API and DB (in `apps/api`): `npm run dev`.
2. Create a license and copy its key — sign up on the portal (auto-provisions a
   trial) or use the operator "Create license" action.
3. Run with the key and server URL:

```bash
SEMPDF_LICENSE_SERVER=http://localhost:8787 \
SEMPDF_LICENSE_KEY=<your-key> \
npx tsx examples/05-live-server.ts
```

Optional: `DEMO_BATCHES` and `DEMO_PAGES` control how much is generated — raise
them to push past 90/95/100% of the license limit and watch the usage alerts
queue and generation hard-block. Then check the operator dashboard ("Needs
attention", "Recent telemetry") and the org portal ("Page usage").

> **Trials are limited too.** A **trial** gets its page allotment (e.g. 1000
> pages) watermarked "SemPDF - For Trial Use Only", then hard-blocks once those pages are used —
> and is also blocked when the trial *date* passes. The page limit applies to
> every license. Against limit `L` with `DEMO_PAGES = P`: the batch that crosses
> `L` still completes (authorized on the pre-charge count), and the next batch is
> rejected with `limit_reached`.

## How enforcement works

See [`../docs/policy-enforcement.md`](../docs/policy-enforcement.md) for the full
policy (decision order, reserve-as-charge, hard block at 100%, notifications).
