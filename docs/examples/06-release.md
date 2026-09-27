# Example: signed builds and updates

The sixth scenario: the app knows its version, can tell you whether a newer
one exists, and installs it only if the download is signed with the key the
app was built with.

## Try it

```bash
npm run dev          # browser preview: version, update status, version details
npm run tauri dev    # the desktop app
```

1. **About & updates** at the bottom of the left column shows the version
   and platform (`darwin-aarch64`, `linux-x86_64`, `windows-x86_64` — the
   names the update feed uses).
2. **Check for updates.** A build made with the updater's public key asks
   the release feed; a newer, signed build for this platform is offered
   with its notes and **Install and restart**. A build without the key —
   and the browser preview — says it can't verify updates and points to the
   releases page instead of pretending to be up to date.
3. **Copy version details** puts the version, platform, update status and
   library size on the clipboard for a bug report. If the clipboard is
   closed, the text is shown selected to copy by hand. It works even when
   the library file is damaged — which is when a report is most needed.

## How a release is made

`.github/workflows/release.yml`:

- **Tag `v*`** — builds Linux, macOS and Windows with `tauri-action` and
  drafts a GitHub release with the installers and the updater's
  `latest.json`.
- **Run manually** — builds Linux (or all three) and keeps the installers as
  workflow artifacts.

Updates are signed only when the repository has the signing key:

| Setting | What |
|---|---|
| secret `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`) | from `npx tauri signer generate`; signs the update bundles |
| variable `SNIPPET_DESK_UPDATER_PUBKEY` | the public half, compiled into the app |

Without them the build still succeeds, unsigned, and the app says it can't
update itself. The feed URL is the latest release's `latest.json`, so the
releases must be reachable where the app runs.

Operating-system code signing (Apple Developer ID, Windows Authenticode) is
separate from update signing and needs the owner's certificates; it is not
configured.

## Rules

- Versions follow semver precedence: `0.2.0-rc.1` < `0.2.0` < `0.2.1`;
  build metadata is ignored.
- An update is offered only if it is newer, has a build for this platform,
  carries a signature and is served over HTTPS; anything else is a distinct
  error (`no-build-for-platform`, `unsigned-build`, `insecure-url`), never a
  silent "up to date".
- The plugin refuses a download whose signature doesn't match the built-in
  key, and — with `requireSignedVersion` — one signed for another version.

## Commands

| Command | Success | Failure reasons |
|---|---|---|
| `app_version` | `{ version, platform, updates: "configured" \| "not-configured" }` | — |
| `check_for_updates` | `{ status: "upToDate", current }` or `{ status: "available", current, version, notes, date }` | `updates-not-configured`, `update-check-failed: …` |
| `install_update` | restarts into the new version | `updates-not-configured`, `no-pending-update`, `update-install-failed: …` |

## Edge cases and where they are checked

- **Closed clipboard** — copying the version details is refused and the
  text is offered for a manual copy (`test/integration/06-release.test.ts`).
- **An untrusted feed** — a failed or mismatched check is an error, not
  "up to date"; the decision rules are in `test/domain/06-release.test.ts`.
- **No key in the build** — no network request is made
  (`src-tauri/src/updates.rs`), and the plugin configuration in
  `tauri.conf.json` is checked to load, use HTTPS and require signed
  versions.
- **Damaged library** — the version and the report still work.
