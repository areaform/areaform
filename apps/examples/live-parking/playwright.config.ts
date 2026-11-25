import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT) || 5196;

export default defineConfig({
    testDir: 'e2e',
    // WebGL runs on SwiftShader in headless Chrome; keep runs predictable rather than parallel.
    workers: 1,
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
    webServer: {
        command: `pnpm exec vite --port ${port} --strictPort`,
        url: `http://localhost:${port}`,
        reuseExistingServer: !process.env.CI,
    },
});
