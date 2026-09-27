<script lang="ts">
  import { onMount } from "svelte";
  import type { Collection, Snippet } from "../../domain/01-library/types";
  import { collectionCounts, filterSnippets } from "../../domain/03-organize/organize";
  import type { LibraryFilter } from "../../domain/03-organize/types";
  import { listCollectionsRemote } from "../../adapters/organize-store";
  import { CollectionsPanel, FilterBar } from "../03-organize";
  import { copySnippetToClipboard, normalizeSearchQuery } from "../../domain/01-library/operations";
  import { clipboardWriter } from "../../adapters/clipboard";
  import { createSnippetRemote, listSnippetsRemote, searchSnippetsRemote } from "../../adapters/snippet-store";
  import { HighlightedCode, SnippetEditor } from "../02-editor";

  let snippets = $state<Snippet[]>([]);
  let loading = $state(true);
  let listError = $state("");

  let title = $state("");
  let language = $state("");
  let code = $state("");
  let formError = $state("");
  let saving = $state(false);

  let searchTerm = $state("");
  let searchResults = $state<Snippet[] | null>(null);
  let searchError = $state("");

  const FILTER_KEY = "snippet-desk:filter";
  function loadFilter(): LibraryFilter {
    try {
      const saved = JSON.parse(localStorage.getItem(FILTER_KEY) ?? "null") as LibraryFilter | null;
      if (saved && "collection" in saved && "tag" in saved) return saved;
    } catch {
      // A filter that can't be read is simply not restored.
    }
    return { collection: null, tag: null };
  }

  let collections = $state<Collection[]>([]);
  let filter = $state<LibraryFilter>(loadFilter());

  function setFilter(next: LibraryFilter) {
    filter = next;
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(next));
    } catch {
      // Not remembering the filter is fine.
    }
  }

  async function loadCollections() {
    const result = await listCollectionsRemote();
    if (result.ok) collections = result.value;
    // A collection that no longer exists would show an empty list with no way back: fall back to all.
    if (filter.collection && filter.collection !== "unfiled" && !collections.some((c) => c.id === filter.collection)) {
      setFilter({ ...filter, collection: null });
    }
  }

  async function onCollectionsChanged() {
    await Promise.all([loadCollections(), loadSnippets()]);
  }

  let copyFeedback = $state<Record<string, string>>({});
  let editingId = $state<string | null>(null);
  const editing = $derived(snippets.find((snippet) => snippet.id === editingId) ?? null);

  function onSaved(saved: Snippet) {
    snippets = [saved, ...snippets.filter((snippet) => snippet.id !== saved.id)];
    if (searchResults) searchResults = searchResults.map((snippet) => (snippet.id === saved.id ? saved : snippet));
  }

  async function loadSnippets() {
    loading = true;
    listError = "";
    const result = await listSnippetsRemote();
    if (result.ok) {
      snippets = result.value;
    } else {
      listError = result.error.message;
    }
    loading = false;
  }

  onMount(() => void Promise.all([loadSnippets(), loadCollections()]));

  async function handleCreate(event: Event) {
    event.preventDefault();
    formError = "";
    saving = true;
    const result = await createSnippetRemote({ title, code, language });
    saving = false;
    if (!result.ok) {
      formError = result.error.kind === "validation" ? result.error.reason : result.error.message;
      return;
    }
    title = "";
    language = "";
    code = "";
    await loadSnippets();
  }

  async function handleSearch(event: Event) {
    event.preventDefault();
    searchError = "";
    const query = normalizeSearchQuery(searchTerm);
    if (!query.ok) {
      searchResults = null;
      return;
    }
    const result = await searchSnippetsRemote(query.value);
    if (result.ok) {
      searchResults = result.value;
    } else {
      searchError = result.error.kind === "validation" ? result.error.reason : result.error.message;
      searchResults = null;
    }
  }

  function clearSearch() {
    searchTerm = "";
    searchResults = null;
    searchError = "";
  }

  async function handleCopy(snippet: Snippet) {
    const result = copySnippetToClipboard(snippet, clipboardWriter);
    copyFeedback = {
      ...copyFeedback,
      [snippet.id]: result.ok ? "Copied" : `Couldn't copy: ${result.error.cause}`,
    };
    setTimeout(() => {
      const { [snippet.id]: _discard, ...rest } = copyFeedback;
      copyFeedback = rest;
    }, 2000);
  }

  const visibleSnippets = $derived(filterSnippets(searchResults ?? snippets, filter));
  const collectionName = (id: string | null) => collections.find((c) => c.id === id)?.name ?? null;
  const filtered = $derived(filter.collection !== null || filter.tag !== null);
</script>

<section class="library">
  {#if editing}
    {#key editing.id}
      <SnippetEditor snippet={editing} {collections} onsaved={onSaved} onclose={() => (editingId = null)} />
    {/key}
  {:else}
  <div class="side">
  <form class="create-form" onsubmit={handleCreate}>
    <h2>New snippet</h2>
    <label>
      Title
      <input bind:value={title} placeholder="Debounce a function" />
    </label>
    <label>
      Language
      <input bind:value={language} placeholder="typescript" />
    </label>
    <label>
      Code
      <textarea bind:value={code} rows="6" placeholder="function debounce(fn, wait)"></textarea>
    </label>
    {#if formError}
      <p class="error" role="alert">{formError}</p>
    {/if}
    <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save snippet"}</button>
  </form>
  <CollectionsPanel {collections} counts={collectionCounts(snippets).byId} onchange={onCollectionsChanged} />
  </div>
  {/if}

  <div class="list-panel">
    <form class="search-form" onsubmit={handleSearch}>
      <input bind:value={searchTerm} placeholder="Search snippets…" aria-label="Search snippets" />
      <button type="submit">Search</button>
      {#if searchResults !== null}
        <button type="button" onclick={clearSearch}>Clear</button>
      {/if}
    </form>
    <FilterBar {snippets} {collections} {filter} onfilter={setFilter} />
    {#if searchError}
      <p class="error" role="alert">{searchError}</p>
    {/if}

    {#if loading}
      <p class="status">Loading snippets…</p>
    {:else if listError}
      <p class="error" role="alert">Couldn't load snippets: {listError}</p>
    {:else if visibleSnippets.length === 0}
      <p class="status">
        {searchResults !== null
          ? "No snippets match that search."
          : filtered
            ? "Nothing here with this filter."
            : "No snippets yet — add one above."}
      </p>
      {#if filtered}
        <button type="button" class="show-all" onclick={() => setFilter({ collection: null, tag: null })}
          >Show all snippets</button
        >
      {/if}
    {:else}
      <ul class="snippets">
        {#each visibleSnippets as snippet (snippet.id)}
          <li class="snippet" class:is-editing={editingId === snippet.id}>
            <div class="snippet-header">
              <strong>{snippet.title}</strong>
              <span class="language">{snippet.language}</span>
            </div>
            {#if snippet.tagIds.length > 0 || snippet.collectionId}
              <div class="meta">
                {#if collectionName(snippet.collectionId)}
                  <span class="collection">{collectionName(snippet.collectionId)}</span>
                {/if}
                {#each snippet.tagIds as tag (tag)}
                  <button
                    type="button"
                    class="tag"
                    aria-label="Show snippets tagged {tag}"
                    onclick={() => setFilter({ ...filter, tag })}>#{tag}</button
                  >
                {/each}
              </div>
            {/if}
            <pre class="code"><HighlightedCode code={snippet.code} language={snippet.language} /></pre>
            <div class="snippet-actions">
              <button type="button" onclick={() => handleCopy(snippet)}>Copy</button>
              <button
                type="button"
                aria-pressed={editingId === snippet.id}
                aria-label="Edit {snippet.title}"
                onclick={() => (editingId = snippet.id)}>Edit</button
              >
              {#if copyFeedback[snippet.id]}
                <span class="feedback">{copyFeedback[snippet.id]}</span>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  .library {
    display: grid;
    grid-template-columns: minmax(280px, 420px) minmax(0, 1fr);
    gap: 1.5rem;
    padding: 1.5rem;
    max-width: 960px;
    margin: 0 auto;
  }

  @media (max-width: 640px) {
    .library {
      grid-template-columns: minmax(0, 1fr);
      padding: 1rem;
    }
  }

  .create-form,
  .list-panel {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
  }

  input,
  textarea {
    font: inherit;
    padding: 0.5rem;
    border-radius: 6px;
    border: 1px solid var(--border, #ccc);
  }

  .search-form {
    display: flex;
    gap: 0.5rem;
  }

  .search-form input {
    flex: 1;
  }

  .snippets {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .snippet {
    border: 1px solid var(--border, #ccc);
    border-radius: 8px;
    padding: 0.75rem;
  }

  .show-all {
    align-self: flex-start;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
    margin-top: 0.35rem;
    font-size: 0.8rem;
  }

  .collection {
    padding: 0.1rem 0.5rem;
    border-radius: 4px;
    background: color-mix(in srgb, currentColor 10%, transparent);
  }

  .tag {
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    font: 0.78rem ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    min-width: 0;
  }

  .snippet.is-editing {
    border-color: light-dark(#1f4fd8, #8fb0ff);
  }

  .snippet-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .language {
    font-size: 0.8rem;
    opacity: 0.7;
  }

  .code {
    overflow-x: auto;
    background: color-mix(in srgb, currentColor 6%, transparent);
    padding: 0.5rem;
    border-radius: 6px;
    font-size: 0.85rem;
  }

  .snippet-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .error {
    color: #c0392b;
  }

  .status {
    opacity: 0.7;
  }

  .feedback {
    font-size: 0.85rem;
    opacity: 0.8;
  }
</style>
