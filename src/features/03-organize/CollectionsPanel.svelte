<script lang="ts">
  import type { Collection } from "../../domain/01-library/types";
  import { validateCollectionName } from "../../domain/03-organize/organize";
  import {
    createCollectionRemote,
    deleteCollectionRemote,
    renameCollectionRemote,
  } from "../../adapters/organize-store";
  import { organizeMessage } from "./messages";

  let {
    collections,
    counts,
    onchange,
  }: { collections: Collection[]; counts: Map<string, number>; onchange: () => void | Promise<void> } = $props();

  let newName = $state("");
  let error = $state("");
  let renamingId = $state<string | null>(null);
  let renameValue = $state("");
  let confirmingId = $state<string | null>(null);

  async function create(event: Event) {
    event.preventDefault();
    // The same rule the database applies, checked first so a duplicate is named before a round trip.
    const checked = validateCollectionName(newName, collections);
    if (!checked.ok) return void (error = organizeMessage(checked.error));
    const result = await createCollectionRemote(newName);
    if (!result.ok) return void (error = organizeMessage(result.error));
    newName = "";
    error = "";
    await onchange();
  }

  function startRename(collection: Collection) {
    renamingId = collection.id;
    renameValue = collection.name;
    confirmingId = null;
    error = "";
  }

  async function rename(event: Event, collection: Collection) {
    event.preventDefault();
    const checked = validateCollectionName(renameValue, collections, collection.id);
    if (!checked.ok) return void (error = organizeMessage(checked.error));
    const result = await renameCollectionRemote(collection.id, renameValue);
    if (!result.ok) return void (error = organizeMessage(result.error));
    renamingId = null;
    error = "";
    await onchange();
  }

  async function remove(collection: Collection) {
    const result = await deleteCollectionRemote(collection.id);
    confirmingId = null;
    if (!result.ok) return void (error = organizeMessage(result.error));
    error = "";
    await onchange();
  }
</script>

<section class="collections" aria-labelledby="collections-heading">
  <h2 id="collections-heading">Collections</h2>
  {#if collections.length === 0}
    <p class="status">No collections yet. Group snippets by project or topic.</p>
  {:else}
    <ul>
      {#each collections as collection (collection.id)}
        <li>
          {#if renamingId === collection.id}
            <form class="inline" onsubmit={(event) => rename(event, collection)}>
              <input bind:value={renameValue} aria-label="New name for {collection.name}" />
              <button type="submit">Save</button>
              <button type="button" onclick={() => (renamingId = null)}>Cancel</button>
            </form>
          {:else if confirmingId === collection.id}
            <span class="confirm">
              Delete “{collection.name}”? Its {counts.get(collection.id) ?? 0} snippet(s) stay in the library.
            </span>
            <span class="row-actions">
              <button type="button" class="danger" onclick={() => remove(collection)}>Delete</button>
              <button type="button" onclick={() => (confirmingId = null)}>Keep</button>
            </span>
          {:else}
            <span class="name">{collection.name} <span class="count">{counts.get(collection.id) ?? 0}</span></span>
            <span class="row-actions">
              <button type="button" class="link" onclick={() => startRename(collection)} aria-label="Rename {collection.name}"
                >Rename</button
              >
              <button
                type="button"
                class="link"
                onclick={() => ((confirmingId = collection.id), (renamingId = null))}
                aria-label="Delete {collection.name}">Delete</button
              >
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  <form class="inline" onsubmit={create}>
    <input bind:value={newName} placeholder="New collection" aria-label="New collection name" />
    <button type="submit">Add</button>
  </form>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .collections {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 0.35rem 0.75rem;
    font-size: 0.9rem;
  }

  .count {
    font-size: 0.8rem;
    opacity: 0.6;
    font-variant-numeric: tabular-nums;
  }

  .row-actions,
  .inline {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .inline input {
    flex: 1;
    min-width: 0;
    font: inherit;
    padding: 0.4rem 0.5rem;
    border-radius: 6px;
    border: 1px solid var(--border, #ccc);
  }

  .confirm {
    flex-basis: 100%;
  }

  .link {
    background: none;
    border: 0;
    padding: 0;
    font-size: 0.85rem;
    color: light-dark(#1f4fd8, #8fb0ff);
    text-decoration: underline;
  }

  .danger {
    color: light-dark(#b3261e, #ff8a80);
  }

  .status {
    margin: 0;
    font-size: 0.85rem;
    opacity: 0.7;
  }

  .error {
    margin: 0;
    color: light-dark(#c0392b, #ff8a80);
  }
</style>
