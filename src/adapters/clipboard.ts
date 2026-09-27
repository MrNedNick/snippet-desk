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

/**
 * Writes text and waits for the answer. `writeText` is asynchronous: a denied permission, a page
 * without focus or a clipboard another app holds rejects the promise *after* the call returns, which
 * the synchronous writer above cannot see. The quick search uses this one so a failed copy is never
 * reported as "Copied".
 */
export async function copyText(text: string): Promise<{ ok: true } | { ok: false; cause: string }> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return { ok: false, cause: "clipboard is unavailable" };
  }
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch (cause) {
    return { ok: false, cause: cause instanceof Error ? cause.message : String(cause) };
  }
}
