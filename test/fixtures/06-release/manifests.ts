/** A `latest.json` as `tauri-action` publishes it, trimmed to two platforms. */
export const manifest = JSON.stringify({
  version: "0.2.0",
  notes: "Import, export and backups.\n\nQuick search remembers what you copied.",
  pub_date: "2026-09-27T10:00:00Z",
  platforms: {
    "darwin-aarch64": {
      signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkK",
      url: "https://github.com/MrNedNick/snippet-desk/releases/download/v0.2.0/snippet-desk_aarch64.app.tar.gz",
    },
    "linux-x86_64": {
      signature: "",
      url: "https://github.com/MrNedNick/snippet-desk/releases/download/v0.2.0/snippet-desk_0.2.0_amd64.AppImage",
    },
    "windows-x86_64": {
      signature: "c2lnbmF0dXJl",
      url: "http://example.com/snippet-desk_0.2.0_x64-setup.exe",
    },
    "broken-platform": { url: 42 },
  },
});

/** Versions in ascending semver order. */
export const ascending = ["0.1.0-alpha", "0.1.0-alpha.1", "0.1.0-alpha.beta", "0.1.0-beta", "0.1.0-beta.2", "0.1.0-beta.11", "0.1.0-rc.1", "0.1.0", "0.1.1", "0.2.0", "1.0.0"];
