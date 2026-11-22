import { defineConfig } from 'vitest/config';

// One run over every package, for `pnpm coverage`; `pnpm test` still runs each package alone.
export default defineConfig({
    test: {
        projects: ['packages/*', 'apps/playground'],
        coverage: {
            provider: 'v8',
            include: ['packages/*/src/**/*.{ts,tsx}'],
            // React components and the Pixi and Three.js renderers are covered by the Playwright tests.
            exclude: [
                '**/*.test.ts',
                'packages/editor/src/react/**',
                'packages/view/src/react/**',
                'packages/view/src/view.ts',
                'packages/view/src/controls.ts',
                'packages/render-2d/src/pixiRenderer.ts',
                'packages/render-3d/src/threeRenderer.ts',
            ],
            reporter: ['text-summary', 'html'],
        },
    },
});
