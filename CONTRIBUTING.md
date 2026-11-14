# Contributing

Thank you for considering a contribution. Clearday Notes aims to stay small, so the best changes
remove friction rather than add features.

## Principles

1. **Minimal.** Every control must earn its place. Prefer a shortcut or a smarter default to a button.
2. **Local-first.** No accounts, no network calls, no telemetry.
3. **No runtime dependencies.** The application is plain ES modules. Development uses only Node's built-in tooling.
4. **Keyboard-first, mouse-friendly.** Every action reachable by keyboard must also be reachable by mouse, and the reverse.
5. **Honest.** Do not claim behaviour that is not tested.

## Development

Requires Node.js 20 or later.

```bash
npm test          # unit tests (parser, dates, store)
npm run check     # static checks (files, syntax, precache list, no inline scripts)
npm run e2e       # real-browser test through Chrome DevTools Protocol (needs Chrome or Chromium)
npm start         # serve on http://localhost:5173
```

Logic belongs in `src/core/` and must be pure and unit-tested. DOM code belongs in `src/ui/`.
Any user-visible behaviour change needs an end-to-end step in `scripts/e2e.mjs`.

## Pull requests

* Keep a pull request to one concern and describe the user-visible effect.
* Add or update tests, and add an entry to `CHANGELOG.md`.
* Never insert user text with `innerHTML`; use the `h()` helper.
* Parser changes need tests, including a case that must *not* be parsed (a title that merely looks like a date).
