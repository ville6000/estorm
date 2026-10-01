import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the browser editor into one self-contained file, dist/web/estorm.html:
// no server and no network needed, so it can be shared as a file or hosted
// on any static web server.
export default defineConfig({
  root: 'web',
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    rollupOptions: { input: 'web/estorm.html' },
  },
  server: { open: '/estorm.html' },
  // Tests live outside the editor's root.
  test: { root: import.meta.dirname },
});
