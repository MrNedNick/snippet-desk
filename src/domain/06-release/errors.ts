export type ReleaseReason =
  | "invalid-version"
  | "not-json"
  | "not-a-manifest"
  | "no-build-for-platform"
  | "unsigned-build"
  | "insecure-url";

export interface ReleaseError {
  kind: "release";
  reason: ReleaseReason;
  /** The value that was refused: a version string, a platform key or a URL. */
  value?: string;
}

export function releaseError(reason: ReleaseReason, value?: string): ReleaseError {
  return { kind: "release", reason, ...(value !== undefined ? { value } : {}) };
}

/** This build has no updater public key, so it cannot verify — and therefore will not install — updates. */
export interface UpdatesNotConfigured {
  kind: "updates-not-configured";
}

export const updatesNotConfigured: UpdatesNotConfigured = { kind: "updates-not-configured" };
