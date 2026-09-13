# snippet-desk

A desktop code snippet library. Find a snippet with a global shortcut and
paste it straight into whatever editor you're in.

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

## Testing

```bash
npm test    # domain unit tests (vitest)
npm run check   # svelte-check / TypeScript
```
