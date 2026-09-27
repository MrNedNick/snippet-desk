<script lang="ts">
  import { setAsideDamagedLibraryRemote } from "../../adapters/quick-store";

  interface Props {
    detail: string;
    /** Called once a fresh library is ready. */
    onrecovered: (keptAs: string) => void;
  }

  let { detail, onrecovered }: Props = $props();

  let confirming = $state(false);
  let working = $state(false);
  let failure = $state("");

  async function setAside() {
    working = true;
    failure = "";
    const result = await setAsideDamagedLibraryRemote();
    working = false;
    if (result.ok) onrecovered(result.value);
    else failure = result.error.kind === "backend" ? result.error.message : result.error.kind === "database-corrupted" ? result.error.detail : "not found";
  }
</script>

<section class="damaged" role="alert" aria-labelledby="damaged-title">
  <h2 id="damaged-title">The library file is damaged</h2>
  <p>
    Snippet Desk can't read it, so nothing is shown and nothing is written — an empty library saved on top would
    lose what is still in the file.
  </p>
  <p class="detail"><code>{detail}</code></p>
  {#if confirming}
    <p>
      The damaged file is kept next to the new one under a new name, so it can still be recovered with SQLite tools.
      The new library starts empty.
    </p>
    <div class="actions">
      <button type="button" disabled={working} onclick={setAside}>{working ? "Setting aside…" : "Keep it aside and start a new library"}</button>
      <button type="button" disabled={working} onclick={() => (confirming = false)}>Cancel</button>
    </div>
  {:else}
    <button type="button" onclick={() => (confirming = true)}>Start a new library…</button>
  {/if}
  {#if failure}
    <p class="failure">Couldn't set it aside: {failure}</p>
  {/if}
</section>

<style>
  .damaged {
    max-width: 640px;
    margin: 2rem auto;
    padding: 1.25rem 1.5rem;
    border: 1px solid light-dark(#e0a800, #8a6d00);
    border-radius: 10px;
    background: color-mix(in srgb, #f5b400 12%, transparent);
  }

  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.15rem;
  }

  .detail code {
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .failure {
    color: light-dark(#b3261e, #ff8a80);
  }
</style>
