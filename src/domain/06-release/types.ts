/** A version as the app and its update manifest write it: `1.2.3` or `1.2.3-beta.2`. */
export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated pre-release identifiers, empty for a release. */
  prerelease: string[];
  raw: string;
}

/**
 * The platforms Tauri's updater publishes for, in its own spelling (`<os>-<arch>`), e.g. `darwin-aarch64`,
 * `windows-x86_64`, `linux-x86_64`.
 */
export type PlatformKey = string;

/** One platform's download in the update manifest. */
export interface PlatformUpdate {
  url: string;
  /** The minisign signature of the file at `url`; the updater refuses a download that doesn't match. */
  signature: string;
}

/** The static `latest.json` Tauri's updater reads. */
export interface UpdateManifest {
  version: Version;
  notes: string;
  pubDate: string | null;
  platforms: Record<PlatformKey, PlatformUpdate>;
}

export type UpdateDecision =
  | { status: "up-to-date"; current: Version }
  | { status: "available"; current: Version; next: Version; notes: string; pubDate: string | null; download: PlatformUpdate };

/** What a bug report needs to know about the running app. */
export interface VersionDetails {
  version: string;
  platform: string;
  /** Whether this build can update itself (a public key was built in). */
  updates: "configured" | "not-configured";
  snippets: number;
}
