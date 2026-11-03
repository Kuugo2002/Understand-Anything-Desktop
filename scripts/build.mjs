import { build as bundle } from 'esbuild';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import fs from 'node:fs/promises';

const root = process.cwd();
await fs.mkdir('dist-desktop', { recursive: true });
await bundle({
  entryPoints: ['desktop/engine.ts'], outfile: 'dist-desktop/engine.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  external: ['web-tree-sitter'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
await build({
  configFile: false, root: path.join(root, 'vendor/dashboard'), base: '/viewer/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: [
    { find: /^@understand-anything\/core\/(.*)$/, replacement: path.join(root, 'vendor/core/src/$1') },
  ] },
  build: { outDir: path.join(root, 'dist-viewer'), emptyOutDir: true },
});
