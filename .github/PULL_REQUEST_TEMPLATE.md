## What & why

<!-- One or two sentences: what changes, and what problem it solves. -->

## Checklist

- [ ] **CHANGELOG.md updated** — every user-visible change gets a bullet under
      `## [Unreleased]` in the same PR (features shipped without changelog
      credit in 2.1.0 because this was done later — don't repeat that).
- [ ] Tests cover the change (`npm test` green).
- [ ] For schema changes: migration generated (`npm run db:generate` in
      `license-server/apps/api`), reviewed, and committed.
- [ ] No secrets/credentials in the diff (keys, tokens, connection strings).
- [ ] PDF/UA impact considered for anything touching text, structure, or
      layout (tagged output, embedded fonts, reading order).
