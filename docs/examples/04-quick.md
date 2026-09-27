# Example: quick search and the clipboard

The fourth working scenario: in any app, press the global shortcut, type a
few letters, press Enter — the snippet is on the clipboard and the window
steps aside, so ⌘V / Ctrl+V pastes it into the editor you were in.

## Try it

```bash
npm run tauri dev    # the desktop app, with the global shortcut
npm run dev          # browser preview: ⌘K / Ctrl+K opens the same search
```

1. Switch to another app and press **⌘⇧Space** (Ctrl+Shift+Space on
   Windows and Linux). Snippet Desk comes forward with the search open.
2. Type `retry`. Every word must match, so `retry fetch` narrows further;
   a word at the start of a title ranks above a tag, which ranks above the
   code.
3. ↑↓ to choose, **Enter** to copy. The window hides again and the
   clipboard holds the code exactly as saved.
4. Open the search again with an empty box: the snippets you copied last
   come first, marked *recent*. A copy from the **Copy** button in the
   list counts too.
5. **Change** in the footer sets another shortcut. It is registered before
   the old one is released and saved only once the system accepts it.

In the browser preview a web page cannot own a system-wide shortcut, so the
footer says so and ⌘K / Ctrl+K opens the search; everything else behaves
the same.

## Rules

- **Shortcuts** need a modifier and one key (a letter, a digit, F1–F24,
  Space, an arrow…). Combinations other apps rely on — copy, paste, cut,
  select all, undo, quit, close, switch — are refused unless another
  modifier makes them distinct (`⌘⇧V` is fine, `⌘V` is not). A combination
  another app already owns comes back as *the system refused it*.
- **Recent uses** keep one entry per snippet (copying it again moves it to
  the top), at most 20, and forget deleted snippets.
- **The clipboard gets the code untouched**: tabs, CRLF, trailing spaces,
  emoji, zero-width joiners and RTL marks included.

## Commands

| Command | Input | Success | Failure reasons |
|---|---|---|---|
| `list_recent_uses` | — | `UsageEntry[]`, most recent first | `database-corrupted: …` |
| `record_snippet_use` | `{ id }` | the updated list | `snippet-not-found`, `database-corrupted: …` |
| `get_quick_shortcut` | — | `{ accelerator, registered, error }` | — |
| `set_quick_shortcut` | `{ accelerator }` | the new status | `shortcut-unavailable: …`, `database-corrupted: …` |
| `library_health` | — | `{ status: "ok" \| "damaged", detail }` | — |
| `set_aside_damaged_library` | — | the name the damaged file was kept under | `database-not-damaged` |

## A damaged library

If the SQLite file can't be read — truncated by an interrupted copy, not a
database at all, failing `PRAGMA quick_check` — the app still starts, shows
what SQLite said, and writes nothing: an empty library saved on top would
lose whatever is still recoverable. **Start a new library…** renames the
file (and its `-wal`/`-shm`) to `snippet-desk.damaged-<time>.sqlite3` next
to the new one; nothing is deleted. The browser preview does the same with
preview data that no longer parses.

## Edge cases and where they are checked

- **Closed clipboard** — the copy is awaited, so a refusal is reported
  instead of "Copied"; the palette shows the code selected for a manual
  copy, and nothing is recorded as used (`test/integration/04-quick.test.ts`).
- **Special characters** — saved, listed and copied byte for byte; lines
  are counted like an editor does (a final line break adds none).
- **Duplicates** — one recent entry per snippet in both backends
  (`test/domain/04-quick.test.ts`, `src-tauri/src/quick.rs`,
  `src-tauri/tests/04-quick.rs`).
- **Damaged database** — garbage bytes and a file cut in half are both
  caught at start-up; every command answers `database-corrupted`, and the
  file survives being set aside (`src-tauri/tests/04-quick.rs`).
- **Import cancelled** — import arrives with the next milestone.
