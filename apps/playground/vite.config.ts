import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/** `.env` lives at the repository root, shared by every app and tool. */
const envDir = fileURLToPath(new URL('../..', import.meta.url));

/**
 * The favicon is the shared `brand/favicon.svg`, outside the app. The build bundles it from index.html;
 * the dev server would answer its relative URL with the page, so point it at `/@fs/` instead.
 */
const favicon = fileURLToPath(new URL('../../brand/favicon.svg', import.meta.url));
const devFavicon: Plugin = {
    name: 'dev-favicon',
    apply: 'serve',
    transformIndexHtml: (html) =>
        html.replace('href="../../brand/favicon.svg"', `href="/@fs${favicon}"`),
};

/**
 * Cloudflare Web Analytics on the demo, as on the site (ADR-0026): page views, no cookies. Only in a
 * build with `PUBLIC_CF_BEACON_TOKEN` set, so development and builds without it send nothing.
 */
function beacon(token: string | undefined): Plugin {
    return {
        name: 'cloudflare-beacon',
        apply: 'build',
        transformIndexHtml: () =>
            token
                ? [
                      {
                          tag: 'script',
                          attrs: {
                              defer: true,
                              src: 'https://static.cloudflareinsights.com/beacon.min.js',
                              'data-cf-beacon': JSON.stringify({ token }),
                          },
                          injectTo: 'body',
                      },
                  ]
                : [],
    };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, envDir, '');
    const port = Number(env.PORT) || 5173;
    return {
        envDir,
        // Relative asset paths, so the build works from any folder on a static server.
        base: './',
        plugins: [react(), devFavicon, beacon(env.PUBLIC_CF_BEACON_TOKEN)],
        // The playground is an app with React and the whole Editor, not a widget; what sites
        // download is measured by `pnpm size` (scripts/size/), so Vite's 500 KB warning is noise.
        build: { chunkSizeWarningLimit: 1024 },
        server: { port, strictPort: true },
        preview: { port, strictPort: true },
    };
});
