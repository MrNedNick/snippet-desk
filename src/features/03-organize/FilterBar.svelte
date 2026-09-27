<script lang="ts">
  import type { Collection, Snippet } from "../../domain/01-library/types";
  import { collectionCounts, tagCounts } from "../../domain/03-organize/organize";
  import type { LibraryFilter } from "../../domain/03-organize/types";

  let {
    snippets,
    collections,
    filter,
    onfilter,
  }: {
    snippets: Snippet[];
    collections: Collection[];
    filter: LibraryFilter;
    onfilter: (filter: LibraryFilter) => void;
  } = $props();

  const counts = $derived(collectionCounts(snippets));
  const tags = $derived(tagCounts(snippets));
</script>

<div class="filters">
  <div class="chips" role="group" aria-label="Collection">
    <button type="button" aria-pressed={filter.collection === null} onclick={() => onfilter({ ...filter, collection: null })}>
      All <span class="count">{snippets.length}</span>
    </button>
    {#each collections as collection (collection.id)}
      <button
        type="button"
        aria-pressed={filter.collection === collection.id}
        onclick={() => onfilter({ ...filter, collection: collection.id })}
      >
        {collection.name} <span class="count">{counts.byId.get(collection.id) ?? 0}</span>
      </button>
    {/each}
    {#if collections.length > 0}
      <button
        type="button"
        aria-pressed={filter.collection === "unfiled"}
        onclick={() => onfilter({ ...filter, collection: "unfiled" })}
      >
        Unfiled <span class="count">{counts.unfiled}</span>
      </button>
    {/if}
  </div>
  {#if tags.length > 0}
    <div class="chips tags" role="group" aria-label="Tag">
      {#each tags as { tag, count } (tag)}
        <button
          type="button"
          aria-pressed={filter.tag === tag}
          onclick={() => onfilter({ ...filter, tag: filter.tag === tag ? null : tag })}
        >
          #{tag} <span class="count">{count}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .filters {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .chips button {
    font-size: 0.85rem;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
  }

  .chips button[aria-pressed="true"] {
    background: light-dark(#1f4fd8, #6d93ff);
    border-color: transparent;
    color: light-dark(#fff, #10131a);
  }

  .tags button {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8rem;
  }

  .count {
    opacity: 0.65;
    font-variant-numeric: tabular-nums;
  }
</style>
