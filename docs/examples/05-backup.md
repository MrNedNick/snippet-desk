# Example: import, export and backups

The fifth working scenario: move a library to another machine, merge two
libraries without duplicates, and undo a mistake from a backup.

## Try it

```bash
npm run tauri dev    # the desktop app: native save and open dialogs
npm run dev          # browser preview: the export downloads, the import uses a file picker
```

1. Under **Import & backups**, **Export…** writes the whole library —
   snippets, earlier versions, tags and collections — as one JSON file
   (`snippet-desk-2026-09-27.json`).
2. On the other machine, **Import…** and pick the file. Nothing is written
   yet: a preview says how many snippets are *new*, *newer in the file*
   (they replace yours, and yours is kept as an earlier version), *yours is
   as new or newer* (left alone) and *already here under another id*
   (skipped). Collections are matched by name, ignoring case.
3. **Apply import** — or **Cancel**, which changes nothing. Before applying,
   the library is backed up automatically.
4. Import the same file again: everything is already there, so there is
   nothing to apply.
5. Under **Backups**, **Back up now** makes one by hand; **Restore…** puts a
   backup back after a confirmation — and backs up what it replaces first,
   so a restore can be undone too. The ten newest backups are kept.

## The archive

```json
{
  "format": "snippet-desk",
  "version": 1,
  "exportedAt": "2026-09-27T10:00:00.000Z",
  "snippets": [{ "id": "…", "title": "…", "code": "…", "language": "…", "tagIds": [], "collectionId": null, "createdAt": "…", "updatedAt": "…" }],
  "revisions": [{ "id": "…", "snippetId": "…", "code": "…", "note": "…", "createdAt": "…" }],
  "collections": [{ "id": "…", "name": "…" }]
}
```

Code is kept byte for byte; tags are normalised the way the library stores
them. A file that isn't JSON, isn't an export, comes from a newer version,
holds more than 5,000 snippets or has a record with a missing field is
refused as a whole, naming the first bad record ("The 2nd snippet in the
file has no valid code").

## Files and SQL stay on the Rust side

The page never passes a file path. `export_library` and `pick_import_file`
open the native dialog in Rust and read or write only what the user picked
there; staging returns a dry-run plan and a token, and `apply_import` runs
the plan in one transaction after a `VACUUM INTO` backup. Restoring
accepts only a name from the backup folder and copies it in with SQLite's
backup API after an integrity check.

## Commands

| Command | Input | Success | Failure reasons |
|---|---|---|---|
| `export_library` | — | `{ status: "saved", path, snippets }` or `{ status: "cancelled" }` | `database-corrupted: …` |
| `pick_import_file` | — | `{ status: "ready", token, plan }` or `{ status: "cancelled" }` | `not-json`, `not-an-archive`, `unsupported-version`, `too-many-snippets`, `invalid-snippet:<n>:<field>`, `invalid-collection:<n>`, `invalid-revision:<n>` |
| `apply_import` | `{ token }` | `{ counts, backup }` | `import-not-found` |
| `cancel_import` | `{ token }` | — | — |
| `create_backup` | — | `BackupInfo` | `database-corrupted: …` |
| `list_backups` | — | `BackupInfo[]`, newest first | — |
| `restore_backup` | `{ name }` | the backup of the replaced state | `backup-not-found`, `database-corrupted: …` |

The browser preview answers `export_library_json` and `stage_import_text`
instead of the two dialog commands.

## Edge cases and where they are checked

- **Cancelled import** — closing the picker and cancelling the preview both
  leave the library and the backup folder untouched; the token is gone
  (`test/integration/05-backup.test.ts`, `src-tauri/tests/05-backup.rs`).
- **Duplicates** — the same snippet under another id is skipped; importing
  a file twice adds nothing the second time.
- **Special characters** — tabs, CRLF, emoji and bidi marks survive export,
  import and the copy from quick search.
- **Damaged database** — import and backups refuse with
  `database-corrupted` instead of writing over the file; setting it aside
  (stage 4) makes them work again.
- **Closed clipboard** — a copy that fails after an import is reported; the
  import stands.
