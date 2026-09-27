# Example: tags and collections

The third working scenario: group snippets by project or topic, tag them,
and narrow the library down to what you are looking for.

## Try it

```bash
npm run dev          # browser preview
npm run tauri dev    # the desktop app
```

1. Under **Collections**, add one — say `Backend helpers`.
2. **Edit** a snippet: type tags separated by commas (`Rust, error handling`)
   and pick the collection. The field shows how the tags will be saved
   (`#rust #error-handling`) before you save.
3. Above the list, pick the collection, then a tag: the list narrows to
   snippets matching both. Tags on a card are buttons too. The filter is
   remembered across reloads.
4. Delete the collection: the confirmation says how many snippets it holds,
   and they stay in the library, unfiled.

## Rules

- **A tag is its own name, normalised.** `React Hooks`, `react-hooks` and
  ` REACT  hooks ` are one tag, `react-hooks`. Letters of any script and
  digits are kept, and so are `+ # . _ -` (`c++`, `c#`, `node.js`); anything
  else separates words. Up to 12 tags per snippet, 32 characters each.
- **Collections are unique ignoring case**, Unicode-aware (`Україна` and
  `УКРАЇНА` clash, which SQLite's `NOCASE` alone would miss). Renaming a
  collection to its own name in another case is allowed.
- The same rules run in `src/domain/03-organize` (checked before anything is
  sent) and `src-tauri/src/organize.rs` (the database's own guard).

## Commands

| Command | Input | Success | Failure reasons |
|---|---|---|---|
| `set_snippet_tags` | `{ id, tags }` | the `Snippet` | `tag-empty`, `tag-too-long`, `too-many-tags`, `snippet-not-found` |
| `set_snippet_collection` | `{ id, collectionId \| null }` | the `Snippet` | `collection-not-found`, `snippet-not-found` |
| `list_collections` | — | `Collection[]`, alphabetical | — |
| `create_collection` | `{ name }` | the `Collection` | `collection-empty`, `collection-too-long`, `collection-exists` |
| `rename_collection` | `{ id, name }` | the `Collection` | the three above, `collection-not-found` |
| `delete_collection` | `{ id }` | — | `collection-not-found` |

## Edge cases and where they are checked

- **Duplicates** — tags in any spelling collapse; a collection name that
  differs only in case is refused with its own message
  (`test/domain/03-organize.test.ts`, `src-tauri/tests/03-organize.rs`).
- **A filter on a deleted collection** — shows nothing rather than the whole
  library, and the list falls back to *All* with a way back.
- **Refusals change nothing** — a bad tag or a missing collection leaves the
  snippet as it was.
- **Old data** — a database or preview data from before collections simply
  starts with none.
