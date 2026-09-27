# Example: editing with highlighting and earlier versions

The second working scenario: open a snippet, edit it in a code field with
syntax colours, save, and get the previous code back if the change was wrong.

## Try it

```bash
npm install
npm run dev          # in a browser: the preview, see below
npm run tauri dev    # the desktop app
```

1. Press **Edit** on a snippet. The editor opens in the left column; the list
   stays on the right with the snippet outlined.
2. Change the code. **Tab** indents; **Esc** then **Tab** moves on to the
   next field, so the keyboard is never trapped. "Unsaved changes" appears.
3. Optionally say what changed, then **Save changes** or press **⌘S / Ctrl+S**.
4. The previous code now sits under **Earlier versions** with its note;
   **Restore into editor** brings it back as a new draft. Close and reopen the
   app: the edit and the history are still there.

## Commands

| Command | Input | Success | Failure reasons |
|---|---|---|---|
| `update_snippet` | `{ input: { id, title, code, language, note } }` | the saved `Snippet` | `title-empty`, `code-empty`, `language-empty`, `snippet-not-found` |
| `list_revisions` | `{ snippetId }` | `Revision[]`, newest first | — |

`db::update_snippet` works in one transaction: it keeps the old code in
`revisions` only when the code actually changed (a rename leaves no revision),
updates the row and replaces its full-text entry so search sees the new text.

## Highlighting

`src/domain/02-editor/highlight.ts` is a small scanner for TypeScript /
JavaScript, Rust, Python, SQL, CSS, shell and JSON: keywords, strings,
numbers and comments. Every character of the code lands in exactly one token,
and tokens are rendered as text, not HTML — so a snippet full of `<script>`,
`&amp;`, emoji, tabs or CRLF shows exactly what is stored. An unclosed string
stops at the end of its line instead of colouring the rest of the file. A
language it does not know is shown plain, with a hint, rather than refused.

The editor is a transparent `<textarea>` over the coloured copy, so typing,
selection, undo and spellcheck-off all stay native.

## Browser preview

Opened outside the desktop shell, the app answers its own commands in the
page (`src/adapters/browser-preview.ts`) with the same names, arguments and
failure reasons, keeps snippets in the browser's storage and starts with
three examples. A banner says so. Inside the desktop app it is never
installed and everything goes to SQLite.

## Edge cases and where they are checked

- **Special characters** — `test/domain/02-editor.test.ts` (every tricky
  fixture comes back from the highlighter unchanged; saved byte for byte),
  `src-tauri/tests/02-editor.rs` (the same through SQLite and search).
- **Empty fields, nothing changed, deleted snippet** — each has its own
  message; `no-changes` is caught before anything is sent.
- **Duplicates** — two snippets with the same code are edited independently.
- **Closed clipboard** — copying reports it instead of failing silently.
- **Corrupt data** — unreadable preview data starts again from the examples;
  on the desktop, a damaged database file is reported (`tests/01-library.rs`).
- **Import cancellation** — no code yet: import arrives with a later milestone.
