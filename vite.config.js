import { defineConfig } from 'vite';

// `--mode poki` produces the Poki-compliant build: no external requests, no
// multiplayer/leaderboard, Poki SDK active. Anything else is the open-web build
// (the Vercel deployment) which keeps Supabase multiplayer.
const POKI_SDK = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js';

/** Injects the Poki SDK script tag, but only into the Poki build. */
function pokiSdkPlugin(enabled) {
  return {
    name: 'poki-sdk',
    transformIndexHtml(html) {
      if (!enabled) return html;
      return html.replace('</head>', `<script src="${POKI_SDK}"></script>\n</head>`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const poki = mode === 'poki';
  return {
    // Poki hosts every build under its own subfolder (e.g. /builds/<id>/), not
    // at the domain root. Vite's default base ('/') emits absolute root paths
    // like /assets/index.js, which 404 under a subfolder — confirmed live
    // against Poki's own Inspector upload. Relative paths fix it, and work
    // identically on Vercel since this app has no client-side routing.
    base: poki ? './' : '/',
    server: { host: '127.0.0.1' },
    build: { target: 'esnext' },
    optimizeDeps: { esbuildOptions: { target: 'esnext' } },
    plugins: [pokiSdkPlugin(poki)],
    define: {
      // A bare constant dead-code-eliminates more reliably than import.meta.env.
      __POKI__: JSON.stringify(poki),
    },
  };
});
