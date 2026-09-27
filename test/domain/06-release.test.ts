import { describe, expect, it } from "vitest";
import {
  compareVersions,
  decideUpdate,
  formatVersionDetails,
  parseUpdateManifest,
  parseVersion,
} from "../../src/domain/06-release";
import { ascending, manifest } from "../fixtures/06-release/manifests";

const v = (raw: string) => {
  const parsed = parseVersion(raw);
  if (!parsed.ok) throw new Error(raw);
  return parsed.value;
};

const parsedManifest = () => {
  const result = parseUpdateManifest(manifest);
  if (!result.ok) throw new Error(result.error.reason);
  return result.value;
};

describe("versions", () => {
  it("reads semver with an optional v, pre-release and build metadata", () => {
    expect(v("v1.2.3")).toMatchObject({ major: 1, minor: 2, patch: 3, prerelease: [], raw: "1.2.3" });
    expect(v("1.2.3-beta.2+build.5").prerelease).toEqual(["beta", "2"]);
  });

  it.each(["", "1.2", "1.2.3.4", "01.2.3", "1.2.x", "latest"])("refuses %j", (raw) => {
    expect(parseVersion(raw)).toEqual({ ok: false, error: { kind: "release", reason: "invalid-version", value: raw } });
  });

  it("orders by semver precedence, pre-releases before the release", () => {
    for (let i = 1; i < ascending.length; i++) {
      expect(compareVersions(v(ascending[i - 1]!), v(ascending[i]!))).toBeLessThan(0);
      expect(compareVersions(v(ascending[i]!), v(ascending[i - 1]!))).toBeGreaterThan(0);
    }
    expect(compareVersions(v("1.0.0+a"), v("1.0.0+b"))).toBe(0);
  });
});

describe("update manifest", () => {
  it("reads latest.json and drops malformed platforms", () => {
    const parsed = parsedManifest();
    expect(parsed.version.raw).toBe("0.2.0");
    expect(Object.keys(parsed.platforms)).toEqual(["darwin-aarch64", "linux-x86_64", "windows-x86_64"]);
    expect(parsed.notes).toContain("backups");
  });

  it.each([
    ["not JSON", "<html>404</html>", "not-json"],
    ["someone else's JSON", '{"name":"x"}', "not-a-manifest"],
    ["a bad version", '{"version":"next","platforms":{}}', "invalid-version"],
  ])("refuses %s", (_label, input, reason) => {
    expect(parseUpdateManifest(input)).toMatchObject({ ok: false, error: { reason } });
  });
});

describe("decideUpdate", () => {
  it("offers a newer, signed, HTTPS build for this platform", () => {
    const decision = decideUpdate("0.1.0", parsedManifest(), "darwin-aarch64");
    expect(decision).toMatchObject({ ok: true, value: { status: "available", next: { raw: "0.2.0" } } });
  });

  it("is up to date on the same or a newer version, and after a pre-release of the same one", () => {
    expect(decideUpdate("0.2.0", parsedManifest(), "darwin-aarch64")).toMatchObject({ ok: true, value: { status: "up-to-date" } });
    expect(decideUpdate("0.3.0-beta", parsedManifest(), "darwin-aarch64")).toMatchObject({ ok: true, value: { status: "up-to-date" } });
    expect(decideUpdate("0.2.0-rc.1", parsedManifest(), "darwin-aarch64")).toMatchObject({ ok: true, value: { status: "available" } });
  });

  it.each([
    ["darwin-x86_64", "no-build-for-platform"],
    ["linux-x86_64", "unsigned-build"],
    ["windows-x86_64", "insecure-url"],
  ])("refuses %s with %s instead of pretending to be up to date", (platform, reason) => {
    expect(decideUpdate("0.1.0", parsedManifest(), platform)).toMatchObject({ ok: false, error: { reason } });
  });
});

describe("formatVersionDetails", () => {
  it("is plain text a bug report can paste", () => {
    expect(formatVersionDetails({ version: "0.1.0", platform: "darwin-aarch64", updates: "not-configured", snippets: 1 })).toBe(
      "Snippet Desk 0.1.0\nPlatform: darwin-aarch64\nUpdates: not configured in this build\nLibrary: 1 snippet",
    );
  });
});
