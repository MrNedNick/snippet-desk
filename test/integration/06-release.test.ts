/**
 * Integration coverage for "Подписанные сборки и обновления": what the About panel does with each answer
 * the backend can give — the browser preview and an unsigned build (no updater key), a signed build
 * with an update or without one, a failed check — plus the version details for a bug report through a
 * working and a closed clipboard. The update decision itself is checked against a real `latest.json`
 * shape, the way the release workflow publishes it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewCommands } from "../../src/adapters/browser-preview";
import { copyText } from "../../src/adapters/clipboard";
import { decideUpdate, formatVersionDetails, parseUpdateManifest } from "../../src/domain/06-release";
import { MemoryStorage } from "../fixtures/memory-storage";
import { manifest } from "../fixtures/06-release/manifests";

let backend: (cmd: string, args?: Record<string, unknown>) => unknown;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => backend(cmd, args),
  isTauri: () => false,
}));

const release = await import("../../src/adapters/release-store");
const library = await import("../../src/adapters/snippet-store");

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  backend = previewCommands(storage);
});

afterEach(() => vi.unstubAllGlobals());

/** A desktop build as the Rust commands answer, with `check` deciding what the release feed says. */
function desktop(check: () => unknown) {
  return (cmd: string) => {
    if (cmd === "app_version") return { version: "0.1.0", platform: "darwin-aarch64", updates: "configured" };
    if (cmd === "check_for_updates") return check();
    throw `unknown command ${cmd}`;
  };
}

describe("updates", () => {
  it("the browser preview and an unsigned build say they can't update, and don't try", async () => {
    expect(await release.appVersionRemote()).toEqual({ ok: true, value: { version: "0.1.0", platform: "browser", updates: "not-configured" } });
    expect(await release.checkForUpdatesRemote()).toEqual({ ok: false, error: { kind: "updates-not-configured" } });
    expect(await release.installUpdateRemote()).toEqual({ ok: false, error: { kind: "updates-not-configured" } });
  });

  it("a signed build reports an available update or that it is up to date", async () => {
    backend = desktop(() => ({ status: "available", current: "0.1.0", version: "0.2.0", notes: "Backups.", date: null }));
    expect(await release.checkForUpdatesRemote()).toMatchObject({ ok: true, value: { status: "available", version: "0.2.0" } });
    backend = desktop(() => ({ status: "upToDate", current: "0.1.0" }));
    expect(await release.checkForUpdatesRemote()).toMatchObject({ ok: true, value: { status: "upToDate" } });
  });

  it("a feed that can't be trusted is an error, not 'up to date'", async () => {
    backend = desktop(() => {
      throw "update-check-failed: the signature was generated for version 0.1.9, not 0.2.0";
    });
    expect(await release.checkForUpdatesRemote()).toEqual({
      ok: false,
      error: { kind: "backend", message: "update-check-failed: the signature was generated for version 0.1.9, not 0.2.0" },
    });
  });

  it("decides from a published latest.json: newer, signed and HTTPS only", () => {
    const parsed = parseUpdateManifest(manifest);
    if (!parsed.ok) throw new Error(parsed.error.reason);
    expect(decideUpdate("0.1.0", parsed.value, "darwin-aarch64")).toMatchObject({ ok: true, value: { status: "available" } });
    expect(decideUpdate("0.1.0", parsed.value, "linux-x86_64")).toMatchObject({ ok: false, error: { reason: "unsigned-build" } });
  });
});

describe("version details for a bug report", () => {
  async function details() {
    const about = await release.appVersionRemote();
    const listed = await library.listSnippetsRemote();
    if (!about.ok || !listed.ok) throw new Error("backend");
    return formatVersionDetails({ ...about.value, snippets: listed.value.length });
  }

  it("copies the version, platform, update status and library size", async () => {
    const clipboard: string[] = [];
    vi.stubGlobal("navigator", { clipboard: { writeText: async (text: string) => void clipboard.push(text) } });
    expect(await copyText(await details())).toEqual({ ok: true });
    expect(clipboard[0]).toBe("Snippet Desk 0.1.0\nPlatform: browser\nUpdates: not configured in this build\nLibrary: 3 snippets");
  });

  it("closed clipboard: the copy is reported as refused, so the panel can show the text to copy by hand", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: async () => Promise.reject(new Error("Write permission denied.")) } });
    expect(await copyText(await details())).toEqual({ ok: false, cause: "Write permission denied." });
  });

  it("still answers with a damaged library, which is exactly when a bug report is needed", async () => {
    storage.setItem("snippet-desk:browser-preview", "{broken");
    backend = previewCommands(storage);
    expect((await release.appVersionRemote()).ok).toBe(true);
    expect((await library.listSnippetsRemote()).ok).toBe(false);
  });
});
