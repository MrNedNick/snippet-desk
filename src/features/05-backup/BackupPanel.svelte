<script lang="ts">
  import { onMount } from "svelte";
  import type { BackupInfo, ImportAction } from "../../domain/05-backup";
  import {
    applyImportRemote,
    cancelImportRemote,
    createBackupRemote,
    exportLibrary,
    listBackupsRemote,
    restoreBackupRemote,
    stageImport,
    type StagedImport,
  } from "../../adapters/backup-store";
  import { ACTION_LABELS, describeBackup, describeBackupError } from "./messages";

  interface Props {
    /** The library changed (import applied or backup restored): reload what is on screen. */
    onchange: () => void;
  }

  let { onchange }: Props = $props();

  let busy = $state<"" | "export" | "import" | "apply" | "backup" | "restore">("");
  let message = $state("");
  let failure = $state("");
  let staged = $state<StagedImport | null>(null);
  let backups = $state<BackupInfo[] | null>(null);
  let restoring = $state<string | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  const ORDER: ImportAction[] = ["added", "updated", "kept", "duplicate"];

  async function loadBackups() {
    const result = await listBackupsRemote();
    backups = result.ok ? result.value : [];
  }

  onMount(loadBackups);

  function reset() {
    message = "";
    failure = "";
  }

  function download(name: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /** The browser preview's stand-in for the open dialog: resolves to the file's text, or null if closed. */
  function pickText(): Promise<string | null> {
    return new Promise((resolve) => {
      const input = fileInput!;
      input.value = "";
      input.onchange = async () => resolve(input.files?.[0] ? await input.files[0].text() : null);
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  async function onExport() {
    reset();
    busy = "export";
    const result = await exportLibrary(download);
    busy = "";
    if (!result.ok) failure = describeBackupError(result.error);
    else if ("kind" in result.value) return; // the save dialog was closed: nothing to say
    else if (result.value.status === "saved") message = `Exported ${result.value.snippets} snippets to ${result.value.path}.`;
    else message = `Downloaded ${result.value.name}.`;
  }

  async function onImport() {
    reset();
    busy = "import";
    const result = await stageImport(pickText);
    busy = "";
    if (!result.ok) failure = describeBackupError(result.error);
    else if ("token" in result.value) staged = result.value;
  }

  async function onApply() {
    if (!staged) return;
    busy = "apply";
    const result = await applyImportRemote(staged.token);
    busy = "";
    staged = null;
    if (!result.ok) {
      failure = describeBackupError(result.error);
      return;
    }
    const { added, updated } = result.value.counts;
    message = `Imported: ${added} new, ${updated} updated. The library before the import was backed up.`;
    await loadBackups();
    onchange();
  }

  async function onCancel() {
    if (!staged) return;
    await cancelImportRemote(staged.token);
    staged = null;
    message = "Import cancelled — nothing was changed.";
  }

  async function onBackup() {
    reset();
    busy = "backup";
    const result = await createBackupRemote();
    busy = "";
    if (!result.ok) failure = describeBackupError(result.error);
    else message = "Backed up.";
    await loadBackups();
  }

  async function onRestore(name: string) {
    reset();
    busy = "restore";
    const result = await restoreBackupRemote(name);
    busy = "";
    restoring = null;
    if (!result.ok) {
      failure = describeBackupError(result.error);
      return;
    }
    message = "Restored. What the library held before was backed up first, so this can be undone.";
    await loadBackups();
    onchange();
  }
</script>

<section class="backup" aria-labelledby="backup-title">
  <h2 id="backup-title">Import &amp; backups</h2>

  <div class="actions">
    <button type="button" disabled={busy !== ""} onclick={onExport}>{busy === "export" ? "Exporting…" : "Export…"}</button>
    <button type="button" disabled={busy !== "" || staged !== null} onclick={onImport}>{busy === "import" ? "Reading…" : "Import…"}</button>
    <input bind:this={fileInput} type="file" accept="application/json,.json" hidden />
  </div>

  {#if staged}
    <div class="plan" role="region" aria-label="Import preview">
      <p><strong>Nothing is changed until you apply.</strong> In the file:</p>
      <ul>
        {#each ORDER as action (action)}
          {#if staged.plan.counts[action] > 0}
            <li data-action={action}><strong>{staged.plan.counts[action]}</strong> {ACTION_LABELS[action]}</li>
          {/if}
        {/each}
        {#if staged.plan.newCollections.length > 0}
          <li>New collections: {staged.plan.newCollections.map((c) => c.name).join(", ")}</li>
        {/if}
      </ul>
      {#if staged.plan.counts.added + staged.plan.counts.updated === 0}
        <p class="quiet">Everything in the file is already here.</p>
      {/if}
      <div class="actions">
        <button type="button" disabled={busy !== "" || staged.plan.counts.added + staged.plan.counts.updated === 0} onclick={onApply}>
          {busy === "apply" ? "Importing…" : "Apply import"}
        </button>
        <button type="button" disabled={busy !== ""} onclick={onCancel}>Cancel</button>
      </div>
    </div>
  {/if}

  {#if message}<p class="message" role="status">{message}</p>{/if}
  {#if failure}<p class="failure" role="alert">{failure}</p>{/if}

  <div class="backups">
    <div class="backups-head">
      <h3>Backups</h3>
      <button type="button" disabled={busy !== ""} onclick={onBackup}>{busy === "backup" ? "Backing up…" : "Back up now"}</button>
    </div>
    {#if backups === null}
      <p class="quiet">Loading…</p>
    {:else if backups.length === 0}
      <p class="quiet">No backups yet. One is made automatically before every import.</p>
    {:else}
      <ul class="backup-list">
        {#each backups as entry (entry.name)}
          <li>
            <span>{describeBackup(entry)}</span>
            {#if restoring === entry.name}
              <span class="confirm">
                Replace the library with this?
                <button type="button" disabled={busy !== ""} onclick={() => onRestore(entry.name)}>Restore</button>
                <button type="button" onclick={() => (restoring = null)}>Cancel</button>
              </span>
            {:else}
              <button type="button" class="link" disabled={busy !== ""} onclick={() => (restoring = entry.name)}>Restore…</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  .backup {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  h3 {
    margin: 0;
    font-size: 0.95rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .plan {
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border, #ccc);
    border-radius: 8px;
    font-size: 0.9rem;
  }

  .plan p {
    margin: 0 0 0.35rem;
  }

  .plan ul {
    margin: 0 0 0.6rem;
    padding-inline-start: 1.1rem;
  }

  .backups-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }

  .backup-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.85rem;
  }

  .backup-list li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.35rem;
  }

  .confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
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

  .quiet {
    margin: 0;
    opacity: 0.7;
    font-size: 0.85rem;
  }

  .message,
  .failure {
    margin: 0;
    font-size: 0.9rem;
  }

  .failure {
    color: light-dark(#b3261e, #ff8a80);
  }
</style>
