import { afterEach, describe, expect, it, vi } from "vitest";
import { copySnippetToClipboard } from "../../src/domain/01-library/operations";
import { clipboardWriter } from "../../src/adapters/clipboard";
import { sampleSnippets } from "../fixtures/01-library/snippets";

const originalNavigator = globalThis.navigator;

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: originalNavigator,
    configurable: true,
  });
});

describe("clipboardWriter", () => {
  it("writes the snippet code through the real Clipboard API", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText } },
      configurable: true,
    });

    const [snippet] = sampleSnippets;
    const result = copySnippetToClipboard(snippet, clipboardWriter);

    expect(result.ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith(snippet.code);
  });

  it("surfaces a distinguishable error when the clipboard is closed/unavailable", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      configurable: true,
    });

    const [snippet] = sampleSnippets;
    const result = copySnippetToClipboard(snippet, clipboardWriter);

    expect(result).toEqual({
      ok: false,
      error: { kind: "clipboard-unavailable", cause: "clipboard is unavailable" },
    });
  });
});
