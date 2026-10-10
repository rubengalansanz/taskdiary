# ADR-001: Electron as the desktop shell

- **Status:** Accepted
- **Date:** 2026-10-09
- **Phase:** 0 · Foundations

## Context

TaskDiary is an offline-first desktop diary for logging and reviewing daily tasks. It must
run locally, keep all data on the user's machine, and start fast enough that opening the app
feels like opening a notes file rather than a website.

Two constraints dominate the shell choice:

1. **A relational local database.** The plan mandates SQLite accessed through
   `better-sqlite3`, a synchronous N-API addon. The shell must be able to load a native
   Node addon directly and call it without an async marshalling layer on every query.
2. **A hard security boundary.** The renderer is untrusted by design: it never gets Node
   capability. Whatever shell we pick must enforce `contextIsolation`, refuse
   `nodeIntegration`, and support a real `sandbox`, not merely document that developers
   should behave.

The repository had no code before this phase, so the decision was open.

## Decision

We build TaskDiary on **Electron**, with the browser window locked down from Phase 0:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every
  `BrowserWindow`, without exceptions.
- The renderer reaches the outside world through exactly one global,
  `window.taskDiary`, produced by `contextBridge.exposeInMainWorld` in
  `src/preload/index.ts`. There is no generic `ipcRenderer` passthrough.
- **The database lives in the main process.** `src/main/db/` and `src/main/core/` import
  only `node:*` and `better-sqlite3` — zero Electron imports — so the data layer is a
  plain Node module that runs outside Electron and stays unit-testable in Vitest.

The full contract is described in `PLAN_IMPLEMENTACION.md` §2 and is enforced by
`src/preload/index.ts`, which throws at startup if `contextIsolation` is ever off.

## Consequences

### Positive

- `better-sqlite3` loads directly in the main process. N-API means one prebuilt binary
  serves both Node and Electron, so there is no `electron-builder install-app-deps`
  rebuild step (ADR-011) and no node-gyp toolchain on user machines.
- The whole app is one language, TypeScript, across main, preload and renderer. The
  contract in `src/shared/ipc.ts` is imported by all three targets, so a channel rename
  breaks the build instead of failing silently at runtime.
- Electron's `nativeTheme` gives light/dark switching driven by the OS, pushed to the
  renderer over IPC, with no flash: the main process also sets the window background
  colour before the first paint.
- The security posture is structural rather than aspirational. A compromised or
  malicious renderer has no `require`, no `fs`, no `child_process`, and cannot navigate
  the window to an attacker's page.

### Negative

- The bundle is large. Electron ships a full Chromium and Node runtime, so the packaged
  Windows installer will be measured in tens of megabytes, not single digits.
- Memory footprint is higher than a native shell: idle RSS includes a browser and a
  Node runtime even though TaskDiary renders a single window.
- Two processes and an IPC hop sit between the UI and the data. For this workload —
  local reads and writes on a diary scale — the hop is negligible, but it forbids
  treating the renderer as the source of truth for any data.
- Chromium's update cadence means patching is a recurring maintenance cost.

## Alternatives considered

### Tauri

Tauri produces a much smaller binary and uses the OS webview instead of bundling
Chromium. Rejected because:

- Its default backend is Rust. Adopting it means maintaining a second language, an
  async command layer, and a second toolchain, in a project whose plan assumes one
  TypeScript codebase.
- `better-sqlite3` would have to be reached through a custom Rust command surface or
  `tauri-plugin-sql`, changing the data layer the plan specifies and moving schema
  work out of the TypeScript module that already owns it.
- The OS webview (WebView2 on Windows, WKWebView on macOS) differs per platform, which
  adds exactly the cross-platform rendering risk an offline-first diary does not need.

Tauri remains the right answer if bundle size ever becomes the binding constraint.

### Local-first web app / PWA

A PWA has the smallest distribution story of all — a URL. Rejected because:

- Offline storage (IndexedDB, OPFS) is not a relational database with foreign keys and
  WAL journaling. The plan's query model assumes SQL.
- A browser tab cannot own a single-instance lock or guarantee the data directory
  layout the backup and export features in later phases depend on.
- It would forfeit native integration: system theme, menu bar, single-instance
  behaviour, and the `userData` directory all have to be reimplemented or dropped.

## References

- `PLAN_IMPLEMENTACION.md` §2 (security rules 1–3, import boundary rule 10), §8.1
  (version matrix), ADR-011 (no `install-app-deps`).
- `odd/tasks/fase-0-cimientos.md` — the feature document this decision was implemented
  under.
