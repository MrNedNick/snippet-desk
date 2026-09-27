import { invoke } from "@tauri-apps/api/core";
import type { NewSnippetInput, Revision, SearchQuery, Snippet } from "../domain/01-library/types";
import type { EditorDraft } from "../domain/02-editor/types";
import type { Result, ValidationError, ValidationReason } from "../domain/01-library/errors";
import { err, ok, validationError } from "../domain/01-library/errors";

export interface BackendError {
  kind: "backend";
  message: string;
}

/** The snippet was removed (or never existed) by the time the edit reached the database. */
export interface NotFoundError {
  kind: "not-found";
}

const VALIDATION_REASONS: readonly ValidationReason[] = [
  "title-empty",
  "code-empty",
  "language-empty",
  "query-empty",
];

/** Rust commands fail with a plain reason string; known ones map back onto the domain's ValidationError. */
function toEditError(reason: string): ValidationError | NotFoundError | BackendError {
  return reason === "snippet-not-found" ? { kind: "not-found" } : toStoreError(reason);
}

function toStoreError(reason: string): ValidationError | BackendError {
  if ((VALIDATION_REASONS as readonly string[]).includes(reason)) {
    const field = reason.replace(/-empty$/, "");
    return validationError(reason as ValidationReason, field);
  }
  return { kind: "backend", message: reason };
}

export async function createSnippetRemote(
  input: NewSnippetInput,
): Promise<Result<Snippet, ValidationError | BackendError>> {
  try {
    const snippet = await invoke<Snippet>("create_snippet", {
      input: { title: input.title, code: input.code, language: input.language },
    });
    return ok(snippet);
  } catch (cause) {
    return err(toStoreError(String(cause)));
  }
}

export async function listSnippetsRemote(): Promise<Result<Snippet[], BackendError>> {
  try {
    return ok(await invoke<Snippet[]>("list_snippets"));
  } catch (cause) {
    return err({ kind: "backend", message: String(cause) });
  }
}

export async function searchSnippetsRemote(
  query: SearchQuery,
): Promise<Result<Snippet[], ValidationError | BackendError>> {
  try {
    return ok(await invoke<Snippet[]>("search_snippets", { query: query.raw }));
  } catch (cause) {
    return err(toStoreError(String(cause)));
  }
}

/** Saves an edited snippet; the Rust side keeps the previous code as a revision when the code changed. */
export async function updateSnippetRemote(
  id: string,
  draft: EditorDraft,
): Promise<Result<Snippet, ValidationError | NotFoundError | BackendError>> {
  try {
    const snippet = await invoke<Snippet>("update_snippet", {
      input: { id, title: draft.title, code: draft.code, language: draft.language, note: draft.note },
    });
    return ok(snippet);
  } catch (cause) {
    return err(toEditError(String(cause)));
  }
}

export async function listRevisionsRemote(snippetId: string): Promise<Result<Revision[], BackendError>> {
  try {
    return ok(await invoke<Revision[]>("list_revisions", { snippetId }));
  } catch (cause) {
    return err({ kind: "backend", message: String(cause) });
  }
}
