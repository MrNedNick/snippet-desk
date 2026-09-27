<script lang="ts">
  import { onMount } from "svelte";
  import { formatVersionDetails } from "../../domain/06-release";
  import { copyText } from "../../adapters/clipboard";
  import { appVersionRemote, checkForUpdatesRemote, installUpdateRemote, type AppVersion, type UpdateCheck } from "../../adapters/release-store";
  import { COPY_KEY } from "../04-quick";

  interface Props {
    /** How many snippets the library holds, for the version details. */
    snippetCount: number;
  }

  let { snippetCount }: Props = $props();

  const RELEASES = "https://github.com/MrNedNick/snippet-desk/releases";

  let about = $state<AppVersion | null>(null);
  let check = $state<
    | { status: "idle" }
    | { status: "checking" }
    | { status: "installing" }
    | { status: "done"; result: UpdateCheck }
    | { status: "not-configured" }
    | { status: "error"; message: string }
  >({ status: "idle" });
  let copied = $state("");
  /** The clipboard refused: the details are shown selected for a manual copy. */
  let manual = $state<string | null>(null);

  onMount(async () => {
    const result = await appVersionRemote();
    if (result.ok) about = result.value;
  });

  async function onCheck() {
    check = { status: "checking" };
    const result = await checkForUpdatesRemote();
    if (result.ok) check = { status: "done", result: result.value };
    else if (result.error.kind === "updates-not-configured") check = { status: "not-configured" };
    else check = { status: "error", message: result.error.message.replace(/^update-check-failed:\s*/, "") };
  }

  async function onInstall() {
    check = { status: "installing" };
    const result = await installUpdateRemote();
    // On success the app restarts into the new version and this line never runs.
    if (!result.ok) check = { status: "error", message: "message" in result.error ? result.error.message : "not configured" };
  }

  async function onCopy() {
    if (!about) return;
    manual = null;
    const text = formatVersionDetails({ ...about, snippets: snippetCount });
    const result = await copyText(text);
    if (result.ok) {
      copied = "Copied — paste it into the bug report.";
      setTimeout(() => (copied = ""), 2500);
    } else {
      manual = text;
    }
  }

  function selectAll(node: HTMLTextAreaElement) {
    node.focus();
    node.select();
  }
</script>

<section class="about" aria-labelledby="about-title">
  <h2 id="about-title">About &amp; updates</h2>
  {#if about}
    <p class="version">Snippet Desk <strong>{about.version}</strong> · {about.platform}</p>
  {:else}
    <p class="quiet">Reading the version…</p>
  {/if}

  <div class="actions">
    <button type="button" disabled={check.status === "checking" || check.status === "installing"} onclick={onCheck}>
      {check.status === "checking" ? "Checking…" : "Check for updates"}
    </button>
    <button type="button" disabled={!about} onclick={onCopy}>Copy version details</button>
  </div>

  {#if check.status === "done" && check.result.status === "upToDate"}
    <p role="status">You have the latest version ({check.result.current}).</p>
  {:else if check.status === "done" && check.result.status === "available"}
    <div class="available" role="status">
      <p><strong>{check.result.version}</strong> is available (you have {check.result.current}).</p>
      {#if check.result.notes}<p class="notes">{check.result.notes}</p>{/if}
      <button type="button" onclick={onInstall}>Install and restart</button>
      <p class="quiet">The download is checked against this app's signing key before anything is installed.</p>
    </div>
  {:else if check.status === "installing"}
    <p role="status">Downloading and verifying the update…</p>
  {:else if check.status === "not-configured"}
    <p class="quiet" role="status">
      This build can't verify updates, so it doesn't install them. New versions are on the
      <a href={RELEASES} target="_blank" rel="noreferrer">releases page</a>.
    </p>
  {:else if check.status === "error"}
    <p class="failure" role="alert">Couldn't check for updates: {check.message}</p>
  {/if}

  {#if copied}<p role="status">{copied}</p>{/if}
  {#if manual}
    <div class="manual" role="alert">
      <p>The clipboard is closed — the details are selected below, press {COPY_KEY}.</p>
      <textarea readonly rows="4" use:selectAll>{manual}</textarea>
    </div>
  {/if}
</section>

<style>
  .about {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: 0.9rem;
  }

  h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  p {
    margin: 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .available {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    align-items: flex-start;
  }

  .notes {
    white-space: pre-line;
  }

  .quiet {
    opacity: 0.75;
  }

  .failure {
    color: light-dark(#b3261e, #ff8a80);
  }

  .manual textarea {
    width: 100%;
    font: 0.8rem ui-monospace, SFMono-Regular, Menlo, monospace;
  }
</style>
