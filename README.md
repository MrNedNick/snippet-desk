# snippet-desk

A desktop code snippet library. Find a snippet with a global shortcut and
paste it straight into whatever editor you're in.

## What works today

- **Library and search** — save snippets, find them with full-text search
  (SQLite FTS5), copy one to the clipboard.
- **Editor with highlighting** — edit a snippet in a code field coloured for
  TypeScript/JavaScript, Rust, Python, SQL, CSS, shell or JSON; Tab indents,
  ⌘S saves. Every change to the code keeps the previous version, which can be
  restored into the editor.

Coming next: tags and collections, then the global shortcut.

## Stack

- [Tauri 2](https://tauri.app/) (Rust) for the native shell
- [SvelteKit](https://svelte.dev/) + TypeScript for the UI
- SQLite for local storage, with full-text search over snippets

Chosen deliberately to bring a native desktop stack into the portfolio rather
than another web app: a real global-shortcut listener, a native clipboard
integration, and a Rust backend behind a typed command boundary.

## Architecture

Core entities: `Snippet`, `Revision`, `Tag`, `Collection`. All SQL access goes
through a small set of Rust commands — the frontend never talks to SQLite
directly — and filesystem access is scoped through Tauri's dialog APIs.

The domain layer (`src/domain/`) holds framework-free types and pure
operations (validation, search matching, clipboard payload building), tested
independently of the UI in `test/`.

## Development

```bash
npm install
npm run tauri dev
```

Requires a Rust toolchain (`rustup`) alongside Node.

`npm run dev` opens the same interface in a plain browser. There the app
answers its own commands with the same names and failure reasons as the Rust
side and keeps snippets in browser storage — handy for working on the UI; a
banner makes clear it is not the desktop app.

## Testing

```bash
npm test    # domain, adapter and integration tests (vitest)
npm run check   # svelte-check / TypeScript
cargo test  # Rust unit + integration tests (run from src-tauri/)
```

Walkthroughs with the edge cases and where each one is tested:
[library and search](docs/examples/01-library.md),
[editor, highlighting and earlier versions](docs/examples/02-editor.md).
