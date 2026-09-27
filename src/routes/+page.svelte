<script lang="ts">
  import { onMount } from "svelte";
  import { LibraryView } from "../features/01-library";
  import { DamagedLibrary } from "../features/04-quick";
  import { libraryHealthRemote } from "../adapters/quick-store";

  let { data } = $props();

  // Checked before the library is shown: a damaged file must not look like an empty library.
  let health = $state<{ status: "checking" } | { status: "ok" } | { status: "damaged"; detail: string }>({ status: "checking" });
  let keptAs = $state("");

  onMount(async () => {
    const result = await libraryHealthRemote();
    health =
      result.ok && result.value.status === "damaged"
        ? { status: "damaged", detail: result.value.detail ?? "unknown damage" }
        : { status: "ok" };
  });
</script>

{#if data.browserPreview}
  <p class="preview-banner" role="note">
    Browser preview — snippets are kept in this browser. The desktop app keeps them in a local SQLite database.
  </p>
{/if}
{#if health.status === "damaged"}
  <DamagedLibrary
    detail={health.detail}
    onrecovered={(name) => {
      keptAs = name;
      health = { status: "ok" };
    }}
  />
{:else if health.status === "ok"}
  {#if keptAs}
    <p class="kept-note" role="status">New library started. The damaged file was kept as <code>{keptAs}</code>.</p>
  {/if}
  <LibraryView />
{/if}

<style>
  .preview-banner {
    margin: 0;
    padding: 0.5rem 1rem;
    font-size: 0.85rem;
    text-align: center;
    background: color-mix(in srgb, #f5b400 22%, transparent);
  }

  .kept-note {
    margin: 1rem auto 0;
    max-width: 960px;
    padding: 0 1.5rem;
    font-size: 0.9rem;
  }
</style>
