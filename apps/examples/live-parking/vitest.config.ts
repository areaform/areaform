import { defineConfig } from 'vitest/config';

// Unit tests only; the Playwright spec in e2e/ runs with `pnpm e2e`.
export default defineConfig({
    test: { include: ['src/**/*.test.ts'] },
});
