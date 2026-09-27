import { err, ok, validationError, type Result } from "../01-library/errors";
import { reviseSnippet } from "../01-library/operations";
import type { Snippet } from "../01-library/types";
import { noChangesError, type EditorError } from "./errors";
import type { AppliedDraft, EditorDraft } from "./types";

export function draftFrom(snippet: Snippet): EditorDraft {
  return { title: snippet.title, code: snippet.code, language: snippet.language, note: "" };
}

/** Whether saving `draft` would change anything; a note on its own is not a change. */
export function isDirty(snippet: Snippet, draft: EditorDraft): boolean {
  return draft.title.trim() !== snippet.title || draft.code !== snippet.code || draft.language.trim() !== snippet.language;
}

/**
 * The snippet after `draft` is saved. The code is kept byte for byte — leading spaces, tabs and trailing
 * newlines are part of a snippet — while title and language are trimmed. Changing the code keeps the old
 * code as a revision with the draft's note; renaming alone does not. Returns a validation error for an
 * empty title, code or language, and `no-changes` when there is nothing to save.
 */
export function applyDraft(
  snippet: Snippet,
  draft: EditorDraft,
  now: () => string = () => new Date().toISOString(),
): Result<AppliedDraft, EditorError> {
  const title = draft.title.trim();
  const language = draft.language.trim();
  if (title.length === 0) return err(validationError("title-empty", "title"));
  if (draft.code.length === 0) return err(validationError("code-empty", "code"));
  if (language.length === 0) return err(validationError("language-empty", "language"));
  if (!isDirty(snippet, draft)) return err(noChangesError);

  const timestamp = now();
  const renamed: Snippet = { ...snippet, title, language, updatedAt: timestamp };
  if (draft.code === snippet.code) return ok({ snippet: renamed, revision: null });

  const revised = reviseSnippet(renamed, draft.code, draft.note.trim(), () => timestamp);
  if (!revised.ok) return revised;
  return ok(revised.value);
}
