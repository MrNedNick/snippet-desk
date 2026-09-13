export type SnippetId = string;
export type RevisionId = string;
export type TagId = string;
export type CollectionId = string;

export interface Tag {
  id: TagId;
  name: string;
}

export interface Collection {
  id: CollectionId;
  name: string;
}

export interface Revision {
  id: RevisionId;
  snippetId: SnippetId;
  code: string;
  note: string;
  createdAt: string;
}

export interface Snippet {
  id: SnippetId;
  title: string;
  code: string;
  language: string;
  tagIds: TagId[];
  collectionId: CollectionId | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewSnippetInput {
  title: string;
  code: string;
  language: string;
  tagIds?: TagId[];
  collectionId?: CollectionId | null;
}

export interface SearchQuery {
  raw: string;
  terms: string[];
}

export interface SearchResult {
  snippet: Snippet;
  score: number;
}

export interface ClipboardPayload {
  text: string;
}

export type ClipboardWriter = (text: string) => void;
