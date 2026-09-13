# Papertrail architecture

Papertrail keeps native capabilities in Electron's main process and keeps document UI in the sandboxed renderer.

```text
renderer.mjs → preload.js → trusted IPC in main.js → DocumentStore → filesystem + history store
```

## Source layout

| Path | Responsibility |
| --- | --- |
| `main.js` | Electron lifecycle, native window/menu/dialogs, trusted IPC, and dirty-document confirmation. |
| `preload.js` | The narrow, context-isolated API exposed to the renderer. |
| `renderer.mjs` | UI state, document actions, settings, archive interactions, and DOM event wiring. |
| `renderer/preview.mjs` | Safe Markdown, JSON, and text preview rendering. |
| `renderer/markdown-tools.mjs` | Selection-aware Markdown helper insertions. |
| `lib/document-types.js` | Supported extensions, native dialog filters, and document preview type selection. |
| `lib/document-store.js` | Current-file state, file reads/writes, local archive updates, and native recent-file notifications. |
| `lib/history-store.js` | Validates, atomically persists, lists, searches, and stores virtual categories for the local archive. |
| `test/` | Node tests for archive persistence and document-session behavior. |

## Important boundaries

- Only `main.js` and `lib/` access the filesystem. Renderer code receives document payloads through `preload.js`.
- Every request/response IPC handler goes through `handle()` in `main.js`, which accepts calls only from the bundled page.
- `DocumentStore.open()` records a Markdown open; `DocumentStore.save()` deliberately does not. Keep that distinction if adding open paths.
- Markdown preview disables raw HTML. Preview-only editing returns to the source textarea so rendered HTML is never used as an editor.
- Archive categories are per-file labels in `history.json`; they never rename, move, or rewrite the source document.

## Extending the app

To add a document format, update `lib/document-types.js`, its macOS association in `package.json`, and `renderer/preview.mjs` if it needs a non-Markdown preview. Add a focused `DocumentStore` test when the format changes archive or counter behavior.

To add a UI command, wire it through the native menu in `main.js`, expose it only when needed in `preload.js`, and keep renderer state changes in `renderer.mjs`.

## Verification

```sh
npm test
npm run package
```
