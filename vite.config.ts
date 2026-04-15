import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, Plugin } from 'vite';
import tsconifgPaths from 'vite-tsconfig-paths';

function copySqlJsWasm(): Plugin {
  return {
    name: 'copy-sql-js-wasm',
    writeBundle(options) {
      const outDir = options.dir || resolve(__dirname, 'dist');
      if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
      }
      const src = resolve(__dirname, 'node_modules/sql.js/dist/sql-wasm.wasm');
      const dest = resolve(outDir, 'sql-wasm.wasm');
      copyFileSync(src, dest);
    },
  };
}

// https://vitejs.dev/config/
const isTest = process.env.VITEST === 'true';

export default defineConfig({
  plugins: [
    ...(!isTest ? [react()] : []),
    tsconifgPaths(),
    copySqlJsWasm(),
  ],
  base: '',
  build: {
    target: 'esnext',
    minify: 'esbuild',
    chunkSizeWarningLimit: 1000,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
