import { err, ok, type Result } from "../01-library/errors";
import { releaseError, type ReleaseError } from "./errors";
import type { PlatformKey, UpdateDecision, UpdateManifest, Version, VersionDetails } from "./types";

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** `1.2.3`, `v1.2.3`, `1.2.3-beta.2`, `1.2.3+build.5` (build metadata is ignored, as semver says). */
export function parseVersion(raw: string): Result<Version, ReleaseError> {
  const match = SEMVER.exec(raw.trim());
  if (!match) return err(releaseError("invalid-version", raw));
  return ok({
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
    raw: raw.trim().replace(/^v/, ""),
  });
}

/** Semver precedence: negative if `a` is older, positive if newer, 0 if equal. `1.0.0-beta` < `1.0.0`. */
export function compareVersions(a: Version, b: Version): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) return b.prerelease.length - a.prerelease.length;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads the updater's `latest.json`. Platforms whose entry is malformed are dropped here and reported
 * only if they are the one asked for (`decideUpdate`), so one broken platform doesn't block the others.
 */
export function parseUpdateManifest(input: string): Result<UpdateManifest, ReleaseError> {
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    return err(releaseError("not-json"));
  }
  if (!isRecord(raw) || typeof raw.version !== "string" || !isRecord(raw.platforms)) return err(releaseError("not-a-manifest"));
  const version = parseVersion(raw.version);
  if (!version.ok) return version;
  const platforms: UpdateManifest["platforms"] = {};
  for (const [key, entry] of Object.entries(raw.platforms)) {
    if (isRecord(entry) && typeof entry.url === "string" && typeof entry.signature === "string") {
      platforms[key] = { url: entry.url, signature: entry.signature };
    }
  }
  return ok({
    version: version.value,
    notes: typeof raw.notes === "string" ? raw.notes : "",
    pubDate: typeof raw.pub_date === "string" ? raw.pub_date : null,
    platforms,
  });
}

/**
 * Whether to offer an update: only a newer version, only with a build for this platform, only signed,
 * only over HTTPS. Anything else is a distinct error, never a silent "you're up to date".
 */
export function decideUpdate(
  currentRaw: string,
  manifest: UpdateManifest,
  platform: PlatformKey,
): Result<UpdateDecision, ReleaseError> {
  const current = parseVersion(currentRaw);
  if (!current.ok) return current;
  if (compareVersions(manifest.version, current.value) <= 0) return ok({ status: "up-to-date", current: current.value });
  const download = manifest.platforms[platform];
  if (!download) return err(releaseError("no-build-for-platform", platform));
  if (download.signature.trim() === "") return err(releaseError("unsigned-build", platform));
  if (!download.url.startsWith("https://")) return err(releaseError("insecure-url", download.url));
  return ok({
    status: "available",
    current: current.value,
    next: manifest.version,
    notes: manifest.notes,
    pubDate: manifest.pubDate,
    download,
  });
}

/** Plain text for a bug report — what "Copy version details" puts on the clipboard. */
export function formatVersionDetails(details: VersionDetails): string {
  return [
    `Snippet Desk ${details.version}`,
    `Platform: ${details.platform}`,
    `Updates: ${details.updates === "configured" ? "signed updates enabled" : "not configured in this build"}`,
    `Library: ${details.snippets} ${details.snippets === 1 ? "snippet" : "snippets"}`,
  ].join("\n");
}
