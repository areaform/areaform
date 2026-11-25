import { defineConfig } from 'vite';

export default defineConfig({
    // Relative asset paths, so the build works from any folder on a static server.
    base: './',
    // Three.js comes in its own chunk, loaded the first time 3D is pressed.
    build: { chunkSizeWarningLimit: 1024 },
});
