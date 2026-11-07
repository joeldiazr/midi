import { defineConfig } from 'vite';

// En GitHub Pages el sitio vive en /arco-bobinas/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/arco-bobinas/' : '/',
  build: { chunkSizeWarningLimit: 900 },
}));
