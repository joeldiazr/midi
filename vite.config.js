import { defineConfig } from 'vite';

// En GitHub Pages el sitio vive en /midi/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/midi/' : '/',
  build: { chunkSizeWarningLimit: 900 },
}));
