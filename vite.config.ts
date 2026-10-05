import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the browser editor into one self-contained file, dist/web/estorm.html:
// no server and no network needed, so it can be shared as a file or hosted
// on any static web server. `--mode preview` builds the page `estorm serve`
// shows, dist/web/preview.html, alongside it: one page per build, as a
// single file can't share chunks with another.
export default defineConfig(({ mode }) => ({
  root: 'web',
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: mode !== 'preview',
    rollupOptions: { input: mode === 'preview' ? 'web/preview.html' : 'web/estorm.html' },
  },
  server: { open: '/estorm.html' },
  // Tests live outside the editor's root.
  test: { root: import.meta.dirname },
}));
