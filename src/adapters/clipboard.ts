import type { ClipboardWriter } from "../domain/01-library/types";

/**
 * Real clipboard writer for the desktop app. Throws synchronously when the
 * Clipboard API isn't reachable (e.g. no window, or the webview denied it),
 * which `copySnippetToClipboard` turns into `ClipboardUnavailableError`.
 */
export const clipboardWriter: ClipboardWriter = (text) => {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    throw new Error("clipboard is unavailable");
  }
  void navigator.clipboard.writeText(text);
};
