# Example: local library and search

The first working scenario end to end: save a snippet, find it again by
full-text search, copy it to the clipboard.

## Commands

The frontend never talks to SQLite directly — it goes through three Tauri
commands (`src-tauri/src/commands.rs`), each backed by `src-tauri/src/db.rs`:

| Command | Input | Success | Failure reasons |
|---|---|---|---|
| `create_snippet` | `{ input: { title, code, language } }` | the persisted `Snippet` (id + timestamps added) | `title-empty`, `code-empty`, `language-empty` |
| `list_snippets` | — | `Snippet[]`, newest-updated first | — |
| `search_snippets` | `{ query: string }` | matching `Snippet[]`, ranked by FTS5 `rank` | `query-empty` |

A snippet's `title`, `code` and `language` are stored and searched verbatim,
including characters that are normally FTS5 query-language operators
(`"`, `-`, `OR`, `*`) — those only matter for the *search* side, and
`db::fts_query` quotes every search term before it reaches SQLite so a raw
search string can never be interpreted as a query.

## A session through the frontend adapters

```ts
import { createSnippetRemote, listSnippetsRemote, searchSnippetsRemote } from "../../src/adapters/snippet-store";

const created = await createSnippetRemote({
  title: "Debounce a function",
  code: "function debounce(fn, wait) { /* ... */ }",
  language: "typescript",
});
// created.ok === true, created.value.id is a fresh UUID

const all = await listSnippetsRemote();
// all.value includes the snippet just created

const found = await searchSnippetsRemote({ raw: "debounce", terms: ["debounce"] });
// found.value === [that same snippet]
```

Copying a snippet's code goes through the domain layer directly (no backend
round trip):

```ts
import { copySnippetToClipboard } from "../../src/domain/01-library/operations";
import { clipboardWriter } from "../../src/adapters/clipboard";

copySnippetToClipboard(snippet, clipboardWriter);
// ok: true  — or a ClipboardUnavailableError if the OS clipboard isn't reachable
```

## What's verified, and how

This scenario — the happy path plus its listed edge cases (closed clipboard,
special characters, duplicate entries, a corrupted database file) — is
covered by two automated layers rather than a one-off manual click-through:

- `test/integration/01-library.test.ts` (`npm test`) drives the adapters and
  domain layer together, the same sequence `LibraryView` runs.
- `src-tauri/tests/01-library.rs` (`cargo test`) drives the actual
  `#[tauri::command]` functions against a real temporary SQLite database
  through a mock Tauri app, so validation and the FTS round trip are checked
  at the same boundary the frontend calls through `invoke`.

Running the app itself (`npm run tauri dev`) additionally requires a native
window, which isn't something this checked-in test suite can drive — the
two suites above are the reproducible substitute.

Duplicate snippets (identical title/code/language) are accepted by design —
nothing about a snippet's content is treated as a uniqueness key. Import/export
doesn't exist yet, so "cancelled import" isn't a scenario here; it's slated
for a later milestone in this project's roadmap.
