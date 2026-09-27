<script lang="ts">
  import { onMount } from "svelte";
  import type { Revision, Snippet } from "../../domain/01-library/types";
  import { applyDraft, draftFrom, isDirty } from "../../domain/02-editor/draft";
  import { LANGUAGE_SUGGESTIONS, resolveLanguage } from "../../domain/02-editor/languages";
  import type { EditorDraft } from "../../domain/02-editor/types";
  import { listRevisionsRemote, updateSnippetRemote } from "../../adapters/snippet-store";
  import HighlightedCode from "./HighlightedCode.svelte";

  let { snippet, onsaved, onclose }: { snippet: Snippet; onsaved: (snippet: Snippet) => void; onclose: () => void } =
    $props();

  // The draft starts from the snippet that was opened; the parent remounts the editor for another one.
  // svelte-ignore state_referenced_locally
  let draft = $state<EditorDraft>(draftFrom(snippet));
  let saving = $state(false);
  let message = $state<{ kind: "error" | "saved"; text: string } | null>(null);
  let revisions = $state<Revision[] | null>(null);
  let revisionsError = $state("");
  let escapeArmed = false;

  let textarea: HTMLTextAreaElement | undefined = $state();
  let mirror: HTMLPreElement | undefined = $state();

  const dirty = $derived(isDirty(snippet, draft));
  const known = $derived(resolveLanguage(draft.language) !== null);

  const REASONS: Record<string, string> = {
    "title-empty": "Give the snippet a title.",
    "code-empty": "The code can't be empty.",
    "language-empty": "Say which language this is.",
  };

  async function loadRevisions() {
    revisionsError = "";
    const result = await listRevisionsRemote(snippet.id);
    if (result.ok) revisions = result.value;
    else revisionsError = result.error.message;
  }

  onMount(loadRevisions);

  async function save(event?: Event) {
    event?.preventDefault();
    if (saving) return;
    // The domain decides first, so an empty field or an unchanged draft never reaches the database.
    const checked = applyDraft(snippet, draft);
    if (!checked.ok) {
      message = {
        kind: "error",
        text: checked.error.kind === "no-changes" ? "Nothing to save yet." : REASONS[checked.error.reason] ?? checked.error.reason,
      };
      return;
    }
    saving = true;
    const result = await updateSnippetRemote(snippet.id, draft);
    saving = false;
    if (!result.ok) {
      const error = result.error;
      message = {
        kind: "error",
        text:
          error.kind === "validation"
            ? REASONS[error.reason] ?? error.reason
            : error.kind === "not-found"
              ? "This snippet no longer exists — it may have been deleted."
              : `Couldn't save: ${error.message}`,
      };
      return;
    }
    const codeChanged = result.value.code !== snippet.code;
    message = { kind: "saved", text: codeChanged ? "Saved. The previous code is kept below." : "Saved." };
    draft = { ...draftFrom(result.value) };
    onsaved(result.value);
    if (codeChanged) await loadRevisions();
  }

  function onFormKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") void save(event);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey) return;
    if (event.key === "Escape") {
      // Esc, then Tab, leaves the editor, so the keyboard is never trapped in it.
      escapeArmed = true;
      return;
    }
    if (event.key === "Tab" && !escapeArmed && textarea) {
      event.preventDefault();
      textarea.setRangeText("  ", textarea.selectionStart, textarea.selectionEnd, "end");
      draft.code = textarea.value;
      return;
    }
    escapeArmed = false;
  }

  function syncScroll() {
    if (mirror && textarea) {
      mirror.scrollTop = textarea.scrollTop;
      mirror.scrollLeft = textarea.scrollLeft;
    }
  }

  function restore(revision: Revision) {
    draft.code = revision.code;
    draft.note = revision.note ? `Back to: ${revision.note}` : "Restored an earlier version";
    message = null;
    textarea?.focus();
  }

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
</script>

<!-- While a snippet is open, ⌘S / Ctrl+S saves it from anywhere instead of the browser's "Save page". -->
<svelte:window onkeydown={onFormKeydown} />

<form class="editor" onsubmit={save} aria-label="Edit {snippet.title}">
  <div class="editor-head">
    <h2>Edit snippet</h2>
    <button type="button" class="link" onclick={onclose}>Close</button>
  </div>

  <label>
    Title
    <input bind:value={draft.title} />
  </label>
  <label>
    Language
    <input bind:value={draft.language} list="editor-languages" autocomplete="off" />
    <datalist id="editor-languages">
      {#each LANGUAGE_SUGGESTIONS as name (name)}<option value={name}></option>{/each}
    </datalist>
    {#if draft.language.trim() && !known}
      <span class="hint">No colours for this language — the code is shown plain.</span>
    {/if}
  </label>

  <div class="code-field">
    <span class="label" id="editor-code-label">Code</span>
    <div class="code-stack">
      <pre class="code-mirror" bind:this={mirror} aria-hidden="true"><HighlightedCode
          code={draft.code.endsWith("\n") ? `${draft.code} ` : draft.code}
          language={draft.language}
        /></pre>
      <textarea
        bind:this={textarea}
        bind:value={draft.code}
        aria-labelledby="editor-code-label"
        aria-describedby="editor-code-help"
        spellcheck="false"
        autocapitalize="off"
        rows="12"
        onkeydown={onKeydown}
        onscroll={syncScroll}
      ></textarea>
    </div>
    <span class="hint" id="editor-code-help">Tab indents · Esc then Tab leaves the editor · ⌘S / Ctrl+S saves</span>
  </div>

  <label>
    <span>What changed <span class="optional">(optional)</span></span>
    <input bind:value={draft.note} placeholder="e.g. handle an empty list" />
  </label>

  {#if message}
    <p class={message.kind === "error" ? "error" : "saved"} role={message.kind === "error" ? "alert" : "status"}>
      {message.text}
    </p>
  {/if}
  <div class="actions">
    <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
    {#if dirty}<span class="dirty">Unsaved changes</span>{/if}
  </div>

  <section class="revisions" aria-label="Earlier versions">
    <h3>Earlier versions</h3>
    {#if revisionsError}
      <p class="error" role="alert">Couldn't load earlier versions: {revisionsError}</p>
    {:else if revisions === null}
      <p class="status">Loading earlier versions…</p>
    {:else if revisions.length === 0}
      <p class="status">None yet — saving a change to the code keeps the previous version here.</p>
    {:else}
      <ol>
        {#each revisions as revision (revision.id)}
          <li>
            <div class="revision-head">
              <span>{formatTime(revision.createdAt)}{revision.note ? ` — ${revision.note}` : ""}</span>
              <button type="button" class="link" onclick={() => restore(revision)}>Restore into editor</button>
            </div>
            <pre class="code"><HighlightedCode code={revision.code} language={draft.language} /></pre>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</form>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: 0;
  }

  .editor-head,
  .revision-head,
  .actions {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .actions {
    justify-content: flex-start;
  }

  h2,
  h3 {
    margin: 0;
  }

  h3 {
    font-size: 1rem;
  }

  label,
  .code-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
  }

  input {
    min-width: 0;
    font: inherit;
    padding: 0.5rem;
    border-radius: 6px;
    border: 1px solid var(--border, #ccc);
  }

  .code-stack {
    position: relative;
    display: grid;
    border: 1px solid var(--border, #ccc);
    border-radius: 6px;
    background: color-mix(in srgb, currentColor 4%, transparent);
  }

  /* The coloured copy sits exactly under a transparent textarea, so typing and highlighting line up. */
  .code-mirror,
  textarea {
    grid-area: 1 / 1;
    margin: 0;
    padding: 0.6rem;
    font: 0.85rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre;
    tab-size: 2;
    overflow: auto;
    border: 0;
    min-height: 14rem;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
  }

  .code-mirror {
    pointer-events: none;
    overflow: hidden;
  }

  textarea {
    resize: vertical;
    background: transparent;
    color: transparent;
    caret-color: CanvasText;
    border-radius: 6px;
  }

  textarea::selection {
    background: color-mix(in srgb, Highlight 45%, transparent);
    color: transparent;
  }

  .hint,
  .optional,
  .status {
    font-size: 0.8rem;
    opacity: 0.7;
  }

  .error {
    color: light-dark(#c0392b, #ff8a80);
    margin: 0;
  }

  .saved {
    margin: 0;
    color: light-dark(#1d7a32, #8fd89a);
  }

  .dirty {
    font-size: 0.85rem;
    opacity: 0.8;
  }

  .link {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    font-size: 0.85rem;
    color: light-dark(#1f4fd8, #8fb0ff);
    text-decoration: underline;
    cursor: pointer;
  }

  .revisions ol {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .revision-head {
    font-size: 0.85rem;
  }

  .code {
    overflow-x: auto;
    background: color-mix(in srgb, currentColor 6%, transparent);
    padding: 0.5rem;
    border-radius: 6px;
    font-size: 0.8rem;
    margin: 0.25rem 0 0;
  }
</style>
