import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Shared `.env` at the repository root; variables already set in the shell win.
const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = Number(process.env.E2E_PORT) || 5198;

export default defineConfig({
    testDir: 'e2e',
    // WebGL runs on SwiftShader in headless Chrome; keep runs predictable rather than parallel.
    workers: 1,
    // On CI: a stray test.only fails the run, one retry absorbs a slow software-WebGL frame, and
    // an HTML report is kept for the failure artifact.
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: `http://localhost:${port}`,
        // The installed Google Chrome: no separate browser download.
        channel: 'chrome',
        viewport: { width: 1280, height: 800 },
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    },
    expect: {
        toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' },
    },
    webServer: {
        command: `pnpm exec vite --port ${port} --strictPort`,
        url: `http://localhost:${port}`,
        reuseExistingServer: !process.env.CI,
    },
});
