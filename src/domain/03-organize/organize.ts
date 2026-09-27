import { err, ok, type Result } from "../01-library/errors";
import type { Collection, Snippet, TagId } from "../01-library/types";
import { organizeError, type OrganizeError } from "./errors";
import {
  MAX_COLLECTION_NAME_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_SNIPPET,
  type LibraryFilter,
  type TagCount,
} from "./types";

/**
 * A tag is its own id: `React Hooks`, `react-hooks` and ` REACT  hooks ` are one tag, written
 * `react-hooks`. Letters of any script, digits and `+ # . _ -` are kept (`c++`, `c#`, `node.js`);
 * everything else separates words.
 */
export function normalizeTag(raw: string): Result<TagId, OrganizeError> {
  const tag = raw
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#._-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  if (tag.length === 0) return err(organizeError("tag-empty", raw));
  if (tag.length > MAX_TAG_LENGTH) return err(organizeError("tag-too-long", raw));
  return ok(tag);
}

/**
 * Tags typed into one field, separated by commas: duplicates — in any case or spelling that
 * normalises to the same tag — collapse into one, in the order first typed. Empty pieces between
 * commas are ignored; a piece that is too long, or more tags than a snippet can hold, is refused.
 */
export function parseTags(input: string): Result<TagId[], OrganizeError> {
  const tags: TagId[] = [];
  for (const piece of input.split(",")) {
    if (piece.trim() === "") continue;
    const tag = normalizeTag(piece);
    if (!tag.ok) return tag;
    if (!tags.includes(tag.value)) tags.push(tag.value);
  }
  if (tags.length > MAX_TAGS_PER_SNIPPET) return err(organizeError("too-many-tags", input));
  return ok(tags);
}

export function formatTags(tags: readonly TagId[]): string {
  return tags.join(", ");
}

/**
 * A collection name as it will be stored: trimmed, inner whitespace collapsed, case kept. Refused when
 * empty, too long, or equal — ignoring case — to another collection's name (`except` is the one being
 * renamed, so renaming "Hooks" to "hooks" is allowed).
 */
export function validateCollectionName(
  raw: string,
  existing: readonly Collection[],
  except: string | null = null,
): Result<string, OrganizeError> {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length === 0) return err(organizeError("collection-empty", raw));
  if (name.length > MAX_COLLECTION_NAME_LENGTH) return err(organizeError("collection-too-long", raw));
  const taken = existing.some((c) => c.id !== except && c.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (taken) return err(organizeError("collection-exists", raw));
  return ok(name);
}

/** The snippets a filter shows. A collection that no longer exists shows nothing rather than everything. */
export function filterSnippets(snippets: readonly Snippet[], filter: LibraryFilter): Snippet[] {
  return snippets.filter((snippet) => {
    if (filter.collection === "unfiled" && snippet.collectionId !== null) return false;
    if (filter.collection !== null && filter.collection !== "unfiled" && snippet.collectionId !== filter.collection) {
      return false;
    }
    return filter.tag === null || snippet.tagIds.includes(filter.tag);
  });
}

/** Every tag in use, most used first, then alphabetically. */
export function tagCounts(snippets: readonly Snippet[]): TagCount[] {
  const counts = new Map<TagId, number>();
  for (const snippet of snippets) for (const tag of new Set(snippet.tagIds)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** How many snippets each collection holds, plus the unfiled ones. */
export function collectionCounts(snippets: readonly Snippet[]): { unfiled: number; byId: Map<string, number> } {
  const byId = new Map<string, number>();
  let unfiled = 0;
  for (const snippet of snippets) {
    if (snippet.collectionId === null) unfiled += 1;
    else byId.set(snippet.collectionId, (byId.get(snippet.collectionId) ?? 0) + 1);
  }
  return { unfiled, byId };
}

/** Collections in the order they are listed: alphabetical, ignoring case. */
export function sortCollections(collections: readonly Collection[]): Collection[] {
  return [...collections].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
