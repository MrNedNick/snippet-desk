// Tauri doesn't have a Node.js server to do proper SSR
// so we use adapter-static with a fallback to index.html to put the site in SPA mode
// See: https://svelte.dev/docs/kit/single-page-apps
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info
export const ssr = false;

import { installBrowserPreview } from "../adapters/browser-preview";

// Outside the desktop shell (e.g. `npm run dev` in a browser) the commands are answered in the page,
// with the snippets kept in this browser's storage instead of the app's SQLite file.
export const prerender = false;
export const load = () => ({ browserPreview: installBrowserPreview(window.localStorage) });
