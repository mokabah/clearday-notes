# QA report, version 0.1.0

This report states what was actually run, and what was not.

## Executed

| Check | Result |
| --- | --- |
| `npm test`: 42 unit tests (parser, notes, dates, store, labels, sample data, undo, import/export) on Node 22 | 42 pass |
| `npm run check`: required files exist, every module parses, service-worker precache list matches, no inline scripts or handlers | pass |
| `npm run e2e`: headless Chrome (Google Chrome for Testing 153) driven through the DevTools Protocol, 17 steps, including the single-file build opened from `file://` | 17 pass |
| Visual review of every theme at 1280 px (screenshots in `docs/screenshots`), theme picker, focus and palette, and layout at 640 px width | reviewed; defects found and fixed (see below) |

The end-to-end steps cover: empty start and focus; live chips; adding; view routing; default-to-today; keyboard selection, priority and completion; undo; inline edit and re-parse; command palette; focus mode; theme persistence; persistence across reload; an HTML-injection attempt (`<img onerror>`), which was inserted as text and did not run; no horizontal overflow at a narrow width; no console errors.

## Defects found during development

* The test runner invoked with a directory argument failed on Node 22; the script now uses a glob.
* The end-to-end harness first sent Enter without a text payload, so the form did not submit; harness fixed.
* The screenshot seeding script typed a stray `n` into task titles; harness fixed (not an application defect).
* A light scrollbar on dark overlays was fixed with `color-scheme`.
* Inline `style` attributes were silently blocked by the page's Content-Security-Policy, so label colours were missing. Found in a screenshot; the DOM helper now sets styles through the CSSOM, and an end-to-end step asserts that label dots are coloured.
* The theme picker overflowed short windows; it now scrolls.

## Not verified

* **Electron shell.** Electron was not available offline. `electron/main.js` passes `node --check` only.
* **PWA installation and offline use.** The manifest and service worker are present and the precache list is checked statically, but installation was not exercised in a real browser.
* **The published online demo.** It runs in a sandboxed frame where storage may be unavailable and downloads are blocked, so data may not persist there and export will not work. The author did not open it inside that frame.
* **Browsers other than Chrome**, and operating systems other than Linux.
* **Node 20.** CI is configured for Node 20 and 22; only 22 was run here.
* **GitHub Actions.** The workflow has never run on GitHub.
* **Accessibility.** Roles, labels and focus styles are provided, but no screen-reader testing was done.
* **Large lists.** Rendering re-creates the visible list on each change; it was not profiled with thousands of tasks.
* **Time zones and daylight-saving changes.** Dates are local calendar dates; the logic was tested against a fixed local "now" only.

## Known limitations

No sync, recurring tasks, reminders or sub-tasks (see `docs/DESIGN.md`). Data lives in `localStorage` and is lost if the user clears site data; backups are manual.
