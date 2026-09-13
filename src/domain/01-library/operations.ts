import type {
  ClipboardPayload,
  ClipboardWriter,
  NewSnippetInput,
  Revision,
  SearchQuery,
  SearchResult,
  Snippet,
} from "./types";
import type { ClipboardUnavailableError, Result, ValidationError } from "./errors";
import { clipboardUnavailableError, err, ok, validationError } from "./errors";

function newId(): string {
  return crypto.randomUUID();
}

export function createSnippet(
  input: NewSnippetInput,
  now: () => string = () => new Date().toISOString(),
): Result<Snippet, ValidationError> {
  const title = input.title.trim();
  if (title.length === 0) {
    return err(validationError("title-empty", "title"));
  }
  if (input.code.length === 0) {
    return err(validationError("code-empty", "code"));
  }
  const language = input.language.trim();
  if (language.length === 0) {
    return err(validationError("language-empty", "language"));
  }
  const timestamp = now();
  return ok({
    id: newId(),
    title,
    code: input.code,
    language,
    tagIds: input.tagIds ?? [],
    collectionId: input.collectionId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function reviseSnippet(
  snippet: Snippet,
  newCode: string,
  note: string,
  now: () => string = () => new Date().toISOString(),
): Result<{ snippet: Snippet; revision: Revision }, ValidationError> {
  if (newCode.length === 0) {
    return err(validationError("code-empty", "code"));
  }
  const timestamp = now();
  const revision: Revision = {
    id: newId(),
    snippetId: snippet.id,
    code: snippet.code,
    note,
    createdAt: timestamp,
  };
  return ok({
    snippet: { ...snippet, code: newCode, updatedAt: timestamp },
    revision,
  });
}

export function normalizeSearchQuery(
  raw: string,
): Result<SearchQuery, ValidationError> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return err(validationError("query-empty", "query"));
  }
  const terms = trimmed
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  return ok({ raw: trimmed, terms });
}

function matchScore(snippet: Snippet, query: SearchQuery): number {
  const haystack = [
    snippet.title,
    snippet.code,
    snippet.language,
    ...snippet.tagIds,
  ]
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const term of query.terms) {
    if (haystack.includes(term)) {
      score += snippet.title.toLowerCase().includes(term) ? 2 : 1;
    }
  }
  return score;
}

export function searchSnippets(
  snippets: Snippet[],
  query: SearchQuery,
): SearchResult[] {
  return snippets
    .map((snippet) => ({ snippet, score: matchScore(snippet, query) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function buildClipboardPayload(snippet: Snippet): ClipboardPayload {
  return { text: snippet.code };
}

export function copySnippetToClipboard(
  snippet: Snippet,
  writer: ClipboardWriter,
): Result<ClipboardPayload, ClipboardUnavailableError> {
  const payload = buildClipboardPayload(snippet);
  try {
    writer(payload.text);
    return ok(payload);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return err(clipboardUnavailableError(message));
  }
}
