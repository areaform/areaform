import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
    // Figma plugin scripts run as a function body (top-level `return`), not as modules.
    globalIgnores(['**/dist', '**/coverage', '**/*.figma.js', '**/.astro']),
    {
        files: ['**/*.{ts,tsx}'],
        extends: [js.configs.recommended, tseslint.configs.recommended],
    },
]);
