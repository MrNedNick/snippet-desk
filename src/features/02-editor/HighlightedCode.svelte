<script lang="ts">
  import { highlight } from "../../domain/02-editor/highlight";

  let { code, language }: { code: string; language: string } = $props();

  // Tokens are rendered as text, never as HTML, so a snippet full of markup shows as markup.
  const highlighted = $derived(highlight(code, language));
</script>

<code class="highlighted" data-language={highlighted.language ?? "plain"}
  >{#each highlighted.tokens as token, index (index)}{#if token.kind === "plain"}{token.text}{:else}<span
        class="tok tok-{token.kind}">{token.text}</span
      >{/if}{/each}</code
>

<style>
  .highlighted {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre;
    tab-size: 2;
  }

  .tok-keyword {
    color: light-dark(#8a2bb3, #d7a4ff);
  }

  .tok-string {
    color: light-dark(#1d7a32, #8fd89a);
  }

  .tok-comment {
    color: light-dark(#6b6b76, #9a9aa6);
    font-style: italic;
  }

  .tok-number {
    color: light-dark(#b0490a, #ffb070);
  }
</style>
