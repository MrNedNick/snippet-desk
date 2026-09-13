<script lang="ts">
  import { onMount } from "svelte";
  import type { Snippet } from "../../domain/01-library/types";
  import { copySnippetToClipboard, normalizeSearchQuery } from "../../domain/01-library/operations";
  import { clipboardWriter } from "../../adapters/clipboard";
  import { createSnippetRemote, listSnippetsRemote, searchSnippetsRemote } from "../../adapters/snippet-store";

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

  let copyFeedback = $state<Record<string, string>>({});

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

  onMount(loadSnippets);

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

  const visibleSnippets = $derived(searchResults ?? snippets);
</script>

<section class="library">
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

  <div class="list-panel">
    <form class="search-form" onsubmit={handleSearch}>
      <input bind:value={searchTerm} placeholder="Search snippets…" aria-label="Search snippets" />
      <button type="submit">Search</button>
      {#if searchResults !== null}
        <button type="button" onclick={clearSearch}>Clear</button>
      {/if}
    </form>
    {#if searchError}
      <p class="error" role="alert">{searchError}</p>
    {/if}

    {#if loading}
      <p class="status">Loading snippets…</p>
    {:else if listError}
      <p class="error" role="alert">Couldn't load snippets: {listError}</p>
    {:else if visibleSnippets.length === 0}
      <p class="status">
        {searchResults !== null ? "No snippets match that search." : "No snippets yet — add one above."}
      </p>
    {:else}
      <ul class="snippets">
        {#each visibleSnippets as snippet (snippet.id)}
          <li class="snippet">
            <div class="snippet-header">
              <strong>{snippet.title}</strong>
              <span class="language">{snippet.language}</span>
            </div>
            <pre class="code">{snippet.code}</pre>
            <div class="snippet-actions">
              <button type="button" onclick={() => handleCopy(snippet)}>Copy</button>
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
    grid-template-columns: minmax(240px, 320px) 1fr;
    gap: 1.5rem;
    padding: 1.5rem;
    max-width: 960px;
    margin: 0 auto;
  }

  @media (max-width: 640px) {
    .library {
      grid-template-columns: 1fr;
    }
  }

  .create-form,
  .list-panel {
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
