<script lang="ts">
  import { LibraryView } from "../features/01-library";

  let { data } = $props();
</script>

{#if data.browserPreview}
  <p class="preview-banner" role="note">
    Browser preview — snippets are kept in this browser. The desktop app keeps them in a local SQLite database.
  </p>
{/if}
<LibraryView />

<style>
  .preview-banner {
    margin: 0;
    padding: 0.5rem 1rem;
    font-size: 0.85rem;
    text-align: center;
    background: color-mix(in srgb, #f5b400 22%, transparent);
  }
</style>
