<script lang="ts">
  import { tick } from "svelte";
  import type { Snippet } from "../../domain/01-library/types";
  import { parseShortcut, pastePayload, quickSearch, type UsageEntry } from "../../domain/04-quick";
  import { copyText } from "../../adapters/clipboard";
  import {
    getQuickShortcutRemote,
    listRecentUsesRemote,
    recordSnippetUseRemote,
    setQuickShortcutRemote,
    stepAside,
    type ShortcutStatus,
  } from "../../adapters/quick-store";
  import { COPY_KEY, describeShortcutFailure, displayShortcut, PASTE_KEY, shortcutMessages } from "./messages";

  interface Props {
    snippets: Snippet[];
    /** The library itself is still loading. */
    loading?: boolean;
    open: boolean;
    /** Opened by the global shortcut from another app: step aside after copying so the paste lands there. */
    fromShortcut?: boolean;
    onclose: () => void;
    onused?: (recent: UsageEntry[]) => void;
  }

  let { snippets, loading = false, open, fromShortcut = false, onclose, onused }: Props = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let input = $state<HTMLInputElement | null>(null);
  let query = $state("");
  let active = $state(0);
  let recent = $state<UsageEntry[]>([]);
  let recentError = $state("");
  let copied = $state<{ title: string; lines: number } | null>(null);
  /** The copy failed: the code is shown selected so the user can copy it by hand. */
  let manual = $state<{ title: string; text: string; cause: string } | null>(null);

  let shortcut = $state<ShortcutStatus | null>(null);
  let editingShortcut = $state(false);
  let shortcutDraft = $state("");
  let shortcutError = $state("");

  const results = $derived(quickSearch(snippets, query, recent));

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      void onOpen();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  async function onOpen() {
    query = "";
    active = 0;
    copied = null;
    manual = null;
    await tick();
    input?.focus();
    const [recentResult, shortcutResult] = await Promise.all([listRecentUsesRemote(), getQuickShortcutRemote()]);
    if (recentResult.ok) {
      recent = recentResult.value;
      recentError = "";
    } else {
      recentError =
        recentResult.error.kind === "database-corrupted"
          ? "The library file is damaged — see the notice at the top."
          : `Recent snippets couldn't be loaded: ${"message" in recentResult.error ? recentResult.error.message : "not found"}`;
    }
    if (shortcutResult.ok) shortcut = shortcutResult.value;
  }

  function move(step: number) {
    if (results.length === 0) return;
    active = (active + step + results.length) % results.length;
    document.getElementById(`quick-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const pick = results[active];
      if (pick) void use(pick.snippet);
    }
  }

  async function use(snippet: Snippet) {
    const payload = pastePayload(snippet);
    const result = await copyText(payload.text);
    if (!result.ok) {
      manual = { title: snippet.title, text: payload.text, cause: result.cause };
      return;
    }
    copied = { title: snippet.title, lines: payload.lines };
    const recorded = await recordSnippetUseRemote(snippet.id);
    if (recorded.ok) {
      recent = recorded.value;
      onused?.(recorded.value);
    }
    if (fromShortcut) {
      setTimeout(() => {
        onclose();
        void stepAside();
      }, 700);
    }
  }

  async function saveShortcut(event: Event) {
    event.preventDefault();
    const parsed = parseShortcut(shortcutDraft);
    if (!parsed.ok) {
      shortcutError = shortcutMessages[parsed.error.reason];
      return;
    }
    const saved = await setQuickShortcutRemote(parsed.value.accelerator);
    if (!saved.ok) {
      shortcutError =
        saved.error.kind === "backend" ? describeShortcutFailure(saved.error.message) : "The library file is damaged.";
      return;
    }
    shortcut = saved.value;
    shortcutError = saved.value.registered || !saved.value.error ? "" : describeShortcutFailure(saved.value.error);
    editingShortcut = false;
  }

  function selectAll(node: HTMLTextAreaElement) {
    node.focus();
    node.select();
  }
</script>

<dialog
  bind:this={dialog}
  class="quick"
  aria-labelledby="quick-title"
  onclose={onclose}
  onclick={(event) => {
    if (event.target === dialog) onclose();
  }}
>
  <h2 id="quick-title" class="visually-hidden">Quick search</h2>
  <input
    bind:this={input}
    bind:value={query}
    oninput={() => (active = 0)}
    onkeydown={onKeydown}
    class="quick-input"
    placeholder="Find a snippet to copy…"
    role="combobox"
    aria-expanded="true"
    aria-controls="quick-results"
    aria-activedescendant={results.length > 0 ? `quick-option-${active}` : undefined}
    aria-label="Find a snippet to copy"
    autocomplete="off"
    spellcheck="false"
  />

  {#if manual}
    <div class="manual" role="alert">
      <p>
        The clipboard is closed ({manual.cause}). “{manual.title}” is selected below — press {COPY_KEY}
        to copy it yourself.
      </p>
      <textarea readonly rows="6" use:selectAll>{manual.text}</textarea>
      <button type="button" onclick={() => (manual = null)}>Back to results</button>
    </div>
  {:else if loading}
    <p class="quick-status" role="status">Loading snippets…</p>
  {:else if snippets.length === 0}
    <p class="quick-status">Your library is empty — add a snippet first.</p>
  {:else if results.length === 0}
    <p class="quick-status">No snippet matches “{query.trim()}”.</p>
  {:else}
    <ul id="quick-results" class="quick-results" role="listbox" aria-label="Snippets">
      {#each results as result, index (result.snippet.id)}
        <li
          id="quick-option-{index}"
          role="option"
          aria-selected={index === active}
          class:active={index === active}
          onmousemove={() => (active = index)}
          onclick={() => void use(result.snippet)}
          onkeydown={() => {}}
        >
          <span class="quick-title">{result.snippet.title}</span>
          <span class="quick-meta">
            {#if result.recentRank !== null}<span class="recent">recent</span>{/if}
            {result.snippet.language}
            {#each result.snippet.tagIds.slice(0, 3) as tag (tag)}<span class="quick-tag">#{tag}</span>{/each}
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if copied}
    <p class="quick-copied" role="status">
      Copied “{copied.title}” — {copied.lines === 1 ? "1 line" : `${copied.lines} lines`}. Paste with {PASTE_KEY}.
    </p>
  {/if}
  {#if recentError}
    <p class="quick-error" role="alert">{recentError}</p>
  {/if}

  <footer class="quick-footer">
    <span>↑↓ to choose · Enter to copy · Esc to close</span>
    {#if shortcut}
      {#if editingShortcut}
        <form class="shortcut-form" onsubmit={saveShortcut}>
          <input
            bind:value={shortcutDraft}
            aria-label="Global shortcut"
            aria-invalid={shortcutError !== ""}
            aria-describedby="shortcut-error"
            placeholder="Ctrl+Shift+Space"
          />
          <button type="submit">Save</button>
          <button type="button" onclick={() => ((editingShortcut = false), (shortcutError = ""))}>Cancel</button>
        </form>
      {:else}
        <span>
          {shortcut.registered ? "From any app:" : "Global shortcut:"}
          <kbd>{displayShortcut(shortcut.accelerator)}</kbd>
          <button
            type="button"
            class="link"
            onclick={() => ((editingShortcut = true), (shortcutDraft = shortcut!.accelerator))}>Change</button
          >
        </span>
      {/if}
    {/if}
  </footer>
  {#if shortcutError}
    <p id="shortcut-error" class="quick-error" role="alert">{shortcutError}</p>
  {:else if shortcut && !shortcut.registered && shortcut.error && !editingShortcut}
    <p class="quick-note">{describeShortcutFailure(shortcut.error)}</p>
  {/if}
</dialog>

<style>
  .quick {
    width: min(560px, calc(100vw - 2rem));
    max-height: min(560px, calc(100vh - 4rem));
    margin: 12vh auto auto;
    padding: 0;
    border: 1px solid var(--border, #ccc);
    border-radius: 12px;
    color: inherit;
    background: light-dark(#fff, #1e1f24);
    box-shadow: 0 24px 60px rgb(0 0 0 / 0.35);
    overflow: hidden;
  }

  .quick[open] {
    display: flex;
    flex-direction: column;
  }

  .quick::backdrop {
    background: rgb(0 0 0 / 0.35);
  }

  .quick-input {
    font: inherit;
    font-size: 1.05rem;
    padding: 0.9rem 1rem;
    border: 0;
    border-bottom: 1px solid var(--border, #ccc);
    background: transparent;
    color: inherit;
    outline: none;
  }

  .quick-results {
    list-style: none;
    margin: 0;
    padding: 0.35rem;
    overflow-y: auto;
  }

  .quick-results li {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.55rem 0.7rem;
    border-radius: 8px;
    cursor: pointer;
  }

  .quick-results li.active {
    background: light-dark(#e7eeff, #2c3a5c);
  }

  .quick-title {
    flex: 1 1 auto;
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quick-meta {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    display: flex;
    gap: 0.4rem;
    align-items: baseline;
    font-size: 0.8rem;
    opacity: 0.75;
    white-space: nowrap;
  }

  .recent {
    padding: 0 0.35rem;
    border-radius: 4px;
    background: color-mix(in srgb, currentColor 14%, transparent);
  }

  .quick-tag {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  /* On a phone the title matters more than the tags. */
  @media (max-width: 480px) {
    .quick-tag {
      display: none;
    }
  }

  .quick-status,
  .quick-copied,
  .quick-error,
  .quick-note {
    margin: 0;
    padding: 0.75rem 1rem;
  }

  .quick-status,
  .quick-note {
    opacity: 0.75;
  }

  .quick-copied {
    background: light-dark(#e6f6ea, #1d3b27);
  }

  .quick-error {
    color: light-dark(#b3261e, #ff8a80);
  }

  .manual {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
  }

  .manual p {
    margin: 0;
  }

  .manual textarea {
    font: 0.85rem ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre;
  }

  .manual button {
    align-self: flex-start;
  }

  .quick-footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
    border-top: 1px solid var(--border, #ccc);
    font-size: 0.8rem;
    opacity: 0.85;
  }

  .shortcut-form {
    display: flex;
    gap: 0.35rem;
  }

  .shortcut-form input {
    font: inherit;
    width: 11rem;
    padding: 0.15rem 0.35rem;
  }

  kbd {
    font: 0.8rem ui-monospace, SFMono-Regular, Menlo, monospace;
    padding: 0.05rem 0.35rem;
    border: 1px solid var(--border, #ccc);
    border-radius: 4px;
  }

  .link {
    border: 0;
    background: none;
    padding: 0;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
